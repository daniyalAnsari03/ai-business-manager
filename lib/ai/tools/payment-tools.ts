import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import {
  findById,
  limitSchema,
  readAgentContext,
  resolveCustomer,
  resolveSupplier,
  toolClarify,
  toolFail,
  toolOk,
} from "@/lib/ai/tools/shared";
import { createApprovalAction } from "@/lib/marketing/approval-service";
import type { AgentRunContext } from "@/lib/ai/context";
import { getCustomers } from "@/lib/customers/service";
import { getOrder, getOrders, getOrdersByCustomer } from "@/lib/orders/service";
import { getSupplierBills } from "@/lib/supplier-bills/service";
import { getSuppliers } from "@/lib/suppliers/service";
import { getPayment, listPayments } from "@/lib/payments/service";
import { PAYMENT_METHODS } from "@/lib/payments/types";
import { formatMoney } from "@/lib/format/currency";
import type { CurrencyCode } from "@/lib/business/constants";

/**
 * Payment tools. These NEVER move money directly. `request_payment` and
 * `request_payment_reversal` only ever create a PENDING approval action; the
 * real ledger write happens later, once the owner approves, through the
 * approval executor and the service-role RPC (docs/fix.txt Stage 3). So the
 * model must always say an approval was REQUESTED, never that a payment was
 * recorded.
 */

function money(amount: number, currencyCode: string): string {
  return formatMoney(amount, currencyCode as CurrencyCode);
}

/* ---------------------------------------------------------------------------
 * get_customer_balance — read-only receivables view
 * ------------------------------------------------------------------------ */

export const getCustomerBalanceTool = tool({
  name: "get_customer_balance",
  description:
    "Read how much a customer has paid and still owes, overall and per order. Answers 'Ali se kitne paise aane hain?'. Use customerId when the user picked a candidate from an earlier list.",
  parameters: z.object({
    customerName: z.string().trim().min(1).max(160).optional().nullable(),
    customerId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact customer id from a previous tool result."),
    limit: limitSchema(20, 50),
  }),
  execute: async ({ customerName, customerId, limit }) => {
    const customersResult = await getCustomers();
    if (!customersResult.ok) {
      return toolFail("database_error", "Could not read customers. Ask the user to try again.");
    }
    const customers = customersResult.data;

    // No specific customer: return the balances of the customers who owe money.
    if (!customerName && !customerId) {
      const owing = customers
        .filter((c) => c.totalDue > 0)
        .sort((a, b) => b.totalDue - a.totalDue)
        .slice(0, limit)
        .map((c) => ({
          id: c.id,
          name: c.name,
          totalPaid: c.totalPaid,
          totalDue: c.totalDue,
        }));
      return toolOk({
        customersOwing: owing.length,
        customers: owing,
        hint: "These customers still owe money. Ask which customer to look at closer.",
      });
    }

    const byId = customerId ? findById(customers, customerId) : null;
    const match = byId
      ? { kind: "found" as const, item: byId }
      : resolveCustomer(customerName ?? "", customers);
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such customer. Tell the user honestly; offer to add them.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map((c) => ({ id: c.id, name: c.name })),
        hint: "Several customers match. Ask the user which one they mean.",
      });
    }
    const customer = match.item;
    const ordersResult = await getOrdersByCustomer(customer.id, limit);
    if (!ordersResult.ok) {
      return toolFail("database_error", "Could not read the customer's orders. Ask the user to try again.");
    }
    return toolOk({
      customer: {
        id: customer.id,
        name: customer.name,
        totalPaid: customer.totalPaid,
        totalDue: customer.totalDue,
      },
      orders: ordersResult.data.map((order) => ({
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total,
        paid: order.paid,
        due: order.due,
        paymentStatus: order.paymentStatus,
        orderedAt: order.orderedAt,
      })),
    });
  },
});

/* ---------------------------------------------------------------------------
 * request_payment — always creates a pending approval, never records money
 * ------------------------------------------------------------------------ */

export const requestPaymentTool = tool({
  name: "request_payment",
  description:
    "Request a payment against a customer order (money received) or a supplier bill (money paid). This does NOT record the payment: it creates an approval request the owner must confirm in Marketing → Approvals (every AI payment needs approval, even in full auto). NEVER tell the user the payment was recorded — say an approval was requested.",
  parameters: z.object({
    // Customer side (exactly one target must be identified).
    orderNumber: z.string().trim().max(60).optional().nullable().describe("The order number to record a customer payment against."),
    orderId: z.string().trim().max(60).optional().nullable().describe("Exact order id from a previous tool result."),
    // Supplier side.
    supplierBillId: z.string().trim().max(60).optional().nullable().describe("Exact supplier bill id from a previous tool result."),
    billNumber: z.string().trim().max(60).optional().nullable().describe("Supplier bill number to pay."),
    supplierName: z.string().trim().max(160).optional().nullable().describe("Supplier name when only the supplier is known."),
    amount: z.number().positive().describe("Payment amount. Must not exceed the outstanding due."),
    method: z.enum(PAYMENT_METHODS).describe("Payment method."),
    paidAt: z.string().trim().max(40).optional().nullable().describe("When the payment was made (ISO date/time); defaults to now."),
    reference: z.string().trim().max(200).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    requestId: z
      .string()
      .trim()
      .max(80)
      .optional()
      .nullable()
      .describe("A stable id you choose for THIS distinct payment request, so a retry of the same request is not duplicated. Use a new value for a genuinely new payment."),
  }),
  execute: async (input, ctx) => {
    const context = readAgentContext(ctx);
    if (!context) {
      return toolFail("database_error", "Missing server context. Do not claim anything was done.");
    }

    const wantsSupplier = !!(input.supplierBillId || input.billNumber || input.supplierName) && !input.orderId && !input.orderNumber;
    const target = wantsSupplier
      ? await resolveBillTarget(input)
      : await resolveOrderTarget(input);
    if (!target.ok) return target.failure;
    const t = target.value;

    if (t.kind === "customer" && t.cancelled) {
      return toolFail("order_cancelled", "This order is cancelled, so no payment can be recorded against it. Say so honestly.");
    }
    if (input.amount > t.due + 0.001) {
      return toolFail(
        "invalid_amount",
        `The amount is more than the outstanding due of ${money(t.due, context.currencyCode)}. Ask the user for an amount up to that.`,
      );
    }

    const summary = buildPaymentSummary(context, t, input.amount, input.method);
    const idempotencyKey = paymentIdempotencyKey(context.businessId, "record_payment", t.id, input.amount, input.requestId);

    const created = await createApprovalAction({
      actionType: "record_payment",
      payload: {
        kind: t.kind,
        orderId: t.kind === "customer" ? t.id : null,
        supplierBillId: t.kind === "supplier" ? t.id : null,
        targetLabel: t.label,
        amount: input.amount,
        method: input.method,
        paidAt: input.paidAt ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
      },
      summary,
      idempotencyKey,
    });

    if (!created.ok) {
      const hint =
        created.reason === "duplicate"
          ? "An identical payment request was already completed or rejected. If this is a NEW payment, call this tool again with a new requestId."
          : "The approval request could not be created. Do not claim a payment was recorded.";
      return toolFail(created.reason, hint);
    }

    return toolOk({
      outcome: "needs_approval",
      approval_requested: true,
      payment_recorded: false,
      approvalId: created.data.id,
      approvalStatus: created.data.status,
      target: t.label,
      amount: input.amount,
      method: input.method,
      due: t.due,
      message:
        "An approval request was created. The payment is NOT recorded yet — the owner must approve it in Marketing → Approvals first. Never tell the user the payment has been recorded.",
    });
  },
});

/* ---------------------------------------------------------------------------
 * request_payment_reversal — also always a pending approval
 * ------------------------------------------------------------------------ */

export const requestPaymentReversalTool = tool({
  name: "request_payment_reversal",
  description:
    "Request to cancel an already-recorded payment (a reversal row is added; the original is never deleted). Requires the user's reason. Always creates a pending approval — the reversal is NOT performed until the owner approves it in Marketing → Approvals.",
  parameters: z.object({
    paymentId: z.string().trim().max(60).optional().nullable().describe("Exact payment id from a previous tool result."),
    orderNumber: z.string().trim().max(60).optional().nullable(),
    billNumber: z.string().trim().max(60).optional().nullable(),
    amount: z.number().positive().optional().nullable().describe("Amount of the payment to cancel, when several exist on the same target."),
    reason: z.string().trim().min(1).max(500).describe("Why the payment is being cancelled. Required."),
    requestId: z.string().trim().max(80).optional().nullable().describe("A stable id you choose for THIS distinct reversal request."),
  }),
  execute: async (input, ctx) => {
    const context = readAgentContext(ctx);
    if (!context) {
      return toolFail("database_error", "Missing server context. Do not claim anything was done.");
    }

    const target = await resolvePaymentTarget(input);
    if (!target.ok) return target.failure;
    const t = target.value;

    if (t.status === "reversed") {
      return toolFail("already_reversed", "This payment has already been cancelled. Say so honestly.");
    }
    if (t.kind === "reversal") {
      return toolFail("not_reversible", "This row is itself a cancellation and cannot be cancelled again.");
    }

    const summary = buildReversalSummary(context, t, input.reason);
    const idempotencyKey = paymentIdempotencyKey(context.businessId, "reverse_payment", t.id, t.amount, input.requestId);

    const created = await createApprovalAction({
      actionType: "reverse_payment",
      payload: {
        paymentId: t.id,
        reason: input.reason,
        targetLabel: t.label,
        amount: t.amount,
        method: t.method,
      },
      summary,
      idempotencyKey,
    });

    if (!created.ok) {
      const hint =
        created.reason === "duplicate"
          ? "An identical cancellation request was already completed or rejected. If this is a NEW request, call again with a new requestId."
          : "The approval request could not be created. Do not claim the payment was cancelled.";
      return toolFail(created.reason, hint);
    }

    return toolOk({
      outcome: "needs_approval",
      approval_requested: true,
      payment_cancelled: false,
      approvalId: created.data.id,
      approvalStatus: created.data.status,
      target: t.label,
      amount: t.amount,
      message:
        "An approval request to cancel this payment was created. It is NOT cancelled yet — the owner must approve it in Marketing → Approvals first.",
    });
  },
});

/* ---------------------------------------------------------------------------
 * Shared target resolution + summary helpers
 * ------------------------------------------------------------------------ */

type ResolveResult<T> = { ok: true; value: T } | { ok: false; failure: string };

async function resolveOrderTarget(
  input: { orderId?: string | null; orderNumber?: string | null },
): Promise<ResolveResult<{ kind: "customer"; id: string; label: string; due: number; cancelled: boolean }>> {
  if (input.orderId) {
    const result = await getOrder(input.orderId);
    if (!result.ok) {
      return { ok: false, failure: toolFail("not_found", "No order with that id. Tell the user honestly.") };
    }
    return {
      ok: true,
      value: {
        kind: "customer",
        id: result.data.id,
        label: `Order ${result.data.orderNumber}`,
        due: result.data.due,
        cancelled: result.data.status === "cancelled",
      },
    };
  }
  if (!input.orderNumber) {
    return { ok: false, failure: toolFail("target_required", "Which order is this payment for? Ask the user for the order number, or use a supplier bill.") };
  }
  const ordersResult = await getOrders({ search: input.orderNumber });
  if (!ordersResult.ok) {
    return { ok: false, failure: toolFail("database_error", "Could not read orders. Ask the user to try again.") };
  }
  const needle = input.orderNumber.trim().toLowerCase();
  const exact = ordersResult.data.filter((o) => o.orderNumber.trim().toLowerCase() === needle);
  if (exact.length === 0) {
    return { ok: false, failure: toolFail("not_found", "No order with that number. Tell the user honestly.") };
  }
  if (exact.length > 1) {
    return { ok: false, failure: toolClarify({ multiple_matches: true, candidates: exact.map(orderCandidate), hint: "Several orders match. Ask the user which one." }) };
  }
  const order = exact[0];
  return {
    ok: true,
    value: {
      kind: "customer",
      id: order.id,
      label: `Order ${order.orderNumber}`,
      due: order.due,
      cancelled: order.status === "cancelled",
    },
  };
}

function orderCandidate(order: { id: string; orderNumber: string; due: number }) {
  return { id: order.id, orderNumber: order.orderNumber, due: order.due };
}

async function resolveBillTarget(input: {
  supplierBillId?: string | null;
  billNumber?: string | null;
  supplierName?: string | null;
}): Promise<ResolveResult<{ kind: "supplier"; id: string; label: string; due: number; cancelled: boolean }>> {
  const billsResult = await getSupplierBills(
    input.supplierName || input.billNumber ? { search: input.billNumber ?? undefined } : {},
  );
  if (!billsResult.ok) {
    return { ok: false, failure: toolFail("database_error", "Could not read supplier bills. Ask the user to try again.") };
  }
  const bills = billsResult.data;

  if (input.supplierBillId) {
    const byId = findById(bills, input.supplierBillId);
    if (!byId) {
      return { ok: false, failure: toolFail("not_found", "No supplier bill with that id. Tell the user honestly.") };
    }
    return { ok: true, value: billToTarget(byId) };
  }

  let candidates = bills;

  if (input.billNumber) {
    const needle = input.billNumber.trim().toLowerCase();
    candidates = candidates.filter((b) => (b.billNumber ?? "").trim().toLowerCase() === needle);
    if (candidates.length === 0) {
      return { ok: false, failure: toolFail("not_found", "No supplier bill with that number. Tell the user honestly.") };
    }
  }

  if (input.supplierName) {
    const suppliersResult = await getSuppliers();
    if (!suppliersResult.ok) {
      return { ok: false, failure: toolFail("database_error", "Could not read suppliers. Ask the user to try again.") };
    }
    const match = resolveSupplier(input.supplierName, suppliersResult.data);
    if (match.kind === "not_found") {
      return { ok: false, failure: toolFail("not_found", "No such supplier. Tell the user honestly.") };
    }
    if (match.kind === "ambiguous") {
      return { ok: false, failure: toolClarify({ multiple_matches: true, candidates: match.candidates.map((s) => ({ id: s.id, name: s.name })), hint: "Several suppliers match. Ask the user which one." }) };
    }
    candidates = candidates.filter((b) => b.supplierId === match.item.id);
    if (!input.billNumber) {
      // Only unpaid/partly paid bills are payable.
      candidates = candidates.filter((b) => b.dueAmount > 0);
    }
  }

  if (candidates.length === 0) {
    return { ok: false, failure: toolFail("not_found", "No matching supplier bill. Tell the user honestly.") };
  }
  if (candidates.length > 1) {
    return { ok: false, failure: toolClarify({ multiple_matches: true, candidates: candidates.map(billCandidate), hint: "Several bills match. Ask the user which bill to pay (by bill number)." }) };
  }
  return { ok: true, value: billToTarget(candidates[0]) };
}

function billToTarget(bill: {
  id: string;
  supplierName: string;
  billNumber: string | null;
  dueAmount: number;
  status: string;
}): { kind: "supplier"; id: string; label: string; due: number; cancelled: boolean } {
  return {
    kind: "supplier",
    id: bill.id,
    label: bill.billNumber ? `Bill ${bill.billNumber} (${bill.supplierName})` : `Bill from ${bill.supplierName}`,
    due: bill.dueAmount,
    cancelled: false,
  };
}

function billCandidate(bill: { id: string; billNumber: string | null; dueAmount: number }) {
  return { id: bill.id, billNumber: bill.billNumber, due: bill.dueAmount };
}

async function resolvePaymentTarget(input: {
  paymentId?: string | null;
  orderNumber?: string | null;
  billNumber?: string | null;
  amount?: number | null;
}): Promise<
  ResolveResult<{
    id: string;
    kind: "payment" | "reversal";
    status: "active" | "reversed";
    label: string;
    amount: number;
    method: string;
  }>
> {
  if (input.paymentId) {
    const result = await getPayment(input.paymentId);
    if (!result.ok) {
      return { ok: false, failure: toolFail("not_found", "No payment with that id. Tell the user honestly.") };
    }
    const p = result.data;
    return {
      ok: true,
      value: {
        id: p.id,
        kind: p.kind,
        status: p.status,
        label: p.targetLabel ?? "payment",
        amount: p.amount,
        method: p.method,
      },
    };
  }

  let orderId: string | undefined;
  let billId: string | undefined;
  if (input.orderNumber) {
    const resolved = await resolveOrderTarget({ orderNumber: input.orderNumber });
    if (!resolved.ok) return { ok: false, failure: resolved.failure };
    orderId = resolved.value.id;
  } else if (input.billNumber) {
    const resolved = await resolveBillTarget({ billNumber: input.billNumber });
    if (!resolved.ok) return { ok: false, failure: resolved.failure };
    billId = resolved.value.id;
  } else {
    return { ok: false, failure: toolFail("target_required", "Which payment should be cancelled? Ask for the order number, bill number, or use a payment id.") };
  }

  const listResult = await listPayments(orderId ? { orderId } : { supplierBillId: billId });
  if (!listResult.ok) {
    return { ok: false, failure: toolFail("database_error", "Could not read payments. Ask the user to try again.") };
  }
  let candidates = listResult.data.filter((p) => p.kind === "payment" && p.status === "active");
  if (input.amount != null) {
    candidates = candidates.filter((p) => Math.abs(p.amount - (input.amount as number)) < 0.001);
  }
  if (candidates.length === 0) {
    return { ok: false, failure: toolFail("not_found", "No active payment matches. Tell the user honestly.") };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      failure: toolClarify({
        multiple_matches: true,
        candidates: candidates.map((p) => ({ id: p.id, amount: p.amount, method: p.method, paidAt: p.paidAt })),
        hint: "Several payments match. Ask the user which one to cancel.",
      }),
    };
  }
  const p = candidates[0];
  return {
    ok: true,
    value: { id: p.id, kind: p.kind, status: p.status, label: p.targetLabel ?? "payment", amount: p.amount, method: p.method },
  };
}

function buildPaymentSummary(
  context: AgentRunContext,
  target: { kind: "customer" | "supplier"; label: string; due: number },
  amount: number,
  method: string,
): string {
  const moneyText = money(amount, context.currencyCode);
  if (context.language === "ur") {
    return target.kind === "customer"
      ? `Customer payment approve karein: ${moneyText} (${method}) — ${target.label}.`
      : `Supplier ko payment approve karein: ${moneyText} (${method}) — ${target.label}.`;
  }
  return target.kind === "customer"
    ? `Approve a customer payment of ${moneyText} (${method}) for ${target.label}.`
    : `Approve a supplier payment of ${moneyText} (${method}) for ${target.label}.`;
}

function buildReversalSummary(
  context: AgentRunContext,
  target: { label: string; amount: number; method: string },
  reason: string,
): string {
  const moneyText = money(target.amount, context.currencyCode);
  if (context.language === "ur") {
    return `Payment cancel karne ki approve karein: ${moneyText} (${target.method}) — ${target.label}. Wajah: ${reason}`;
  }
  return `Approve cancelling the payment of ${moneyText} (${target.method}) for ${target.label}. Reason: ${reason}`;
}

function paymentIdempotencyKey(
  businessId: string,
  action: "record_payment" | "reverse_payment",
  targetId: string,
  amount: number,
  requestId?: string | null,
): string {
  const rid = requestId?.trim() || "default";
  const key = `${businessId}:${action}:${targetId}:${amount.toFixed(2)}:${rid}`;
  return key.slice(0, 160);
}
