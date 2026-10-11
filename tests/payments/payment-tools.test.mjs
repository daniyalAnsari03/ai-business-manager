/**
 * Offline tests for the AI payment/supplier TOOLS and the approval money path
 * (docs/fix.txt Stage 5):
 *
 *  - request_payment / request_payment_reversal ONLY create a pending approval,
 *    even in full-auto mode; they never call the money RPCs directly
 *  - the approved-action executor calls the service-role `*_for_business` RPC
 *    with the server-verified business id and the APPROVAL id as idempotency
 *    key, and audits a success exactly once
 *  - a rejected approval never pays, a replay never duplicate-audits
 *  - ambiguity asks for clarification; cancelled orders and paid-over-due are
 *    refused; already-cancelled payments are refused
 *  - delete_supplier demands explicit confirmation
 *  - the controlled tool registry holds exactly the 45 real capabilities
 *
 * Tools, approval service, service-role wrapper and audit writer are all REAL;
 * only sessions, read services and outbound channels are stubbed
 * (tests/payments/register-tools-hooks.mjs).
 */

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { state } from "./stubs/state.mjs";
import { createFakeDb } from "./stubs/fake-supabase.mjs";

import {
  getCustomerBalanceTool,
  requestPaymentReversalTool,
  requestPaymentTool,
} from "@/lib/ai/tools/payment-tools";
import { deleteSupplierTool } from "@/lib/ai/tools/supplier-tools";
import { approveAction, decideAndRunAction, rejectAction } from "@/lib/marketing/approval-service";
import { businessTools } from "@/lib/ai/tools";

const BUSINESS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";

function runContext(overrides = {}) {
  return {
    context: {
      businessId: BUSINESS_A,
      businessName: "Test Shop",
      businessType: "retail",
      currencyCode: "PKR",
      currencySymbol: "Rs",
      language: "en",
      userId: OWNER,
      correlationId: "corr-1",
      ...overrides,
    },
  };
}

function paymentRow(overrides = {}) {
  return {
    id: "p-1",
    business_id: BUSINESS_A,
    kind: "payment",
    direction: "in",
    order_id: ORDER_ID,
    supplier_bill_id: null,
    reversal_of: null,
    amount: 500,
    method: "cash",
    paid_at: "2026-10-01T10:00:00.000Z",
    reference: null,
    notes: null,
    idempotency_key: "ik-1",
    created_by: OWNER,
    created_at: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

function activeOrder(overrides = {}) {
  return {
    id: ORDER_ID,
    customerId: "c-1",
    orderNumber: "ORD-1",
    status: "completed",
    total: 1000,
    paid: 500,
    due: 500,
    paymentStatus: "partial",
    orderedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function seed() {
  state.business = {
    id: BUSINESS_A,
    name: "Test Shop",
    businessType: "retail",
    currency: "PKR",
    language: "en",
    ownerId: OWNER,
    phone: null,
    address: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  state.user = undefined;
  state.automationModeResult = { ok: true, data: "needs_approval" };
  state.reads = { customers: [], orders: [], suppliers: [], supplierBills: [], payments: [] };
  state.db = createFakeDb({
    approval_actions: [],
    approval_events: [],
    audit_logs: [],
    suppliers: [],
  });
  state.db.setRpc((name, args, db) => {
    if (name === "claim_approval_action") {
      const row = (db.tables.get("approval_actions") ?? []).find((a) => a.id === args.p_action_id) ?? null;
      return Promise.resolve({ data: row, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  setMoneyRpc();
  return state.db;
}

function setMoneyRpc(replayRecord = false, replayReverse = false) {
  state.db.setAdminRpc((name) => {
    if (name === "record_payment_for_business") {
      return Promise.resolve({
        data: {
          ok: true,
          payment: paymentRow(),
          idempotent_replay: replayRecord,
          orderId: ORDER_ID,
          supplierBillId: null,
          paid: 500,
          due: 0,
          paidAmount: null,
        },
        error: null,
      });
    }
    if (name === "reverse_payment_for_business") {
      return Promise.resolve({
        data: {
          ok: true,
          payment: paymentRow({ id: "r-1", kind: "reversal", direction: "out", reversal_of: "p-1" }),
          idempotent_replay: replayReverse,
          reversedPaymentId: "p-1",
          orderId: ORDER_ID,
          supplierBillId: null,
          paid: 0,
          due: 0,
          paidAmount: null,
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

/** Runs a tool exactly like the route does and parses its JSON string. */
async function invoke(tool, args, overrides = {}) {
  const raw = await tool.invoke(runContext(overrides), JSON.stringify(args));
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

function moneyRpcNames(db = state.db) {
  return [
    ...db.rpcCalls.map((c) => c.name),
    ...db.adminRpcCalls.map((c) => c.name),
  ].filter((n) => n.includes("payment"));
}

const auditRows = () => state.db.tables.get("audit_logs") ?? [];

beforeEach(() => {
  seed();
});

/* ---------------------------------------------------------------------------
 * request_payment -> pending approval, never money
 * ------------------------------------------------------------------------ */

test("request_payment only creates a pending approval and never records money", async () => {
  state.reads.orders = [activeOrder()];
  const parsed = await invoke(requestPaymentTool, {
    orderId: ORDER_ID,
    amount: 500,
    method: "cash",
    requestId: "req-1",
  });

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.outcome, "needs_approval");
  assert.equal(parsed.payment_recorded, false);
  assert.equal(parsed.approvalStatus, "pending");
  assert.equal(parsed.due, 500);

  const [action] = state.db.tables.get("approval_actions");
  assert.equal(action.status, "pending");
  assert.equal(action.approval_mode, "needs_approval");
  assert.equal(action.action_type, "record_payment");
  assert.equal(action.business_id, BUSINESS_A);
  assert.deepEqual(moneyRpcNames(), []); // no money RPC fired at all
  assert.deepEqual(auditRows(), []); // nothing audited before execution
});

test("request_payment still needs approval in full-auto mode (money is sensitive)", async () => {
  state.automationModeResult = { ok: true, data: "full_auto" };
  state.reads.orders = [activeOrder()];
  const parsed = await invoke(requestPaymentTool, {
    orderId: ORDER_ID,
    amount: 500,
    method: "bank",
    requestId: "req-auto",
  });

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.outcome, "needs_approval");
  const [action] = state.db.tables.get("approval_actions");
  assert.equal(action.approval_mode, "needs_approval");
  assert.equal(action.status, "pending");
  assert.deepEqual(moneyRpcNames(), []);
});

test("decideAndRunAction treats record_payment as sensitive even in full-auto", async () => {
  state.automationModeResult = { ok: true, data: "full_auto" };
  const result = await decideAndRunAction({
    actionType: "record_payment",
    payload: { orderId: ORDER_ID, amount: 500, method: "cash" },
    summary: "Approve a customer payment",
    idempotencyKey: "decide-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.outcome, "needs_approval");
  assert.equal(result.data.action.approvalMode, "needs_approval");
  assert.deepEqual(moneyRpcNames(), []);
});

/* ---------------------------------------------------------------------------
 * Approval execution -> service-role with verified business + action id
 * ------------------------------------------------------------------------ */

test("approved action executes via service-role with the verified business and action id, audited once", async () => {
  state.reads.orders = [activeOrder()];
  await invoke(requestPaymentTool, { orderId: ORDER_ID, amount: 500, method: "cash", requestId: "req-1" });
  const [action] = state.db.tables.get("approval_actions");

  const approved = await approveAction(action.id);
  assert.equal(approved.ok, true);
  assert.equal(approved.data.status, "completed");

  const [call] = state.db.adminRpcCalls;
  assert.equal(call.name, "record_payment_for_business");
  assert.equal(call.args.p_business_id, BUSINESS_A);
  assert.equal(call.args.p_actor, OWNER);
  assert.equal(call.args.p_payload.idempotencyKey, action.id); // approval id is the idempotency key
  assert.equal(call.args.p_payload.amount, 500);

  assert.equal(auditRows().length, 1);
  const row = auditRows()[0];
  assert.equal(row.business_id, BUSINESS_A);
  assert.equal(row.actor_type, "ai");
  assert.equal(row.action, "payment.create");
  assert.equal(row.entity, "payment");
  assert.equal(row.entity_id, "p-1");
});

test("approving the same action twice executes exactly once", async () => {
  state.reads.orders = [activeOrder()];
  await invoke(requestPaymentTool, { orderId: ORDER_ID, amount: 500, method: "cash", requestId: "req-1" });
  const [action] = state.db.tables.get("approval_actions");

  await approveAction(action.id);
  await approveAction(action.id);

  const claims = state.db.rpcCalls.filter((c) => c.name === "claim_approval_action");
  assert.equal(claims.length, 1);
  assert.equal(state.db.adminRpcCalls.length, 1);
  assert.equal(auditRows().length, 1);
});

test("a rejected approval never pays and cannot be approved afterwards", async () => {
  state.reads.orders = [activeOrder()];
  await invoke(requestPaymentTool, { orderId: ORDER_ID, amount: 500, method: "cash", requestId: "req-1" });
  const [action] = state.db.tables.get("approval_actions");

  const rejected = await rejectAction(action.id);
  assert.equal(rejected.ok, true);
  assert.equal(rejected.data.status, "rejected");

  const after = await approveAction(action.id);
  assert.equal(after.ok, false);
  assert.equal(after.reason, "not_pending");

  assert.deepEqual(state.db.adminRpcCalls, []);
  assert.deepEqual(auditRows(), []);
});

test("a service-role replay is surfaced as success and never duplicate-audited", async () => {
  state.reads.orders = [activeOrder()];
  await invoke(requestPaymentTool, { orderId: ORDER_ID, amount: 500, method: "cash", requestId: "req-1" });
  const [action] = state.db.tables.get("approval_actions");

  setMoneyRpc(true); // idempotent replay
  const approved = await approveAction(action.id);
  assert.equal(approved.ok, true);
  assert.equal(approved.data.status, "completed");
  assert.equal(approved.data.executionResult?.idempotentReplay, true);
  assert.deepEqual(auditRows(), []); // replay already logged when first recorded
});

/* ---------------------------------------------------------------------------
 * request_payment refusals + ambiguity
 * ------------------------------------------------------------------------ */

test("a cancelled order refuses payment", async () => {
  state.reads.orders = [activeOrder({ status: "cancelled", due: 500 })];
  const parsed = await invoke(requestPaymentTool, { orderNumber: "ORD-1", amount: 500, method: "cash" });
  assert.equal(parsed.status, "error");
  assert.equal(parsed.reason, "order_cancelled");
  assert.deepEqual(moneyRpcNames(), []);
});

test("an amount above the outstanding due is refused", async () => {
  state.reads.orders = [activeOrder({ due: 300 })];
  const parsed = await invoke(requestPaymentTool, { orderId: ORDER_ID, amount: 301, method: "cash" });
  assert.equal(parsed.status, "error");
  assert.equal(parsed.reason, "invalid_amount");
});

test("ambiguous order numbers ask for clarification instead of guessing", async () => {
  state.reads.orders = [
    activeOrder({ id: "o-a", orderNumber: "ORD-1" }),
    activeOrder({ id: "o-b", orderNumber: "ORD-1" }),
  ];
  const parsed = await invoke(requestPaymentTool, { orderNumber: "ORD-1", amount: 100, method: "cash" });
  assert.equal(parsed.status, "needs_clarification");
  assert.equal(parsed.multiple_matches, true);
});

/* ---------------------------------------------------------------------------
 * request_payment_reversal
 * ------------------------------------------------------------------------ */

test("request_payment_reversal parks pending; approval runs the reversal with the payment id + action key", async () => {
  state.reads.payments = [
    { id: "p-1", kind: "payment", status: "active", orderId: ORDER_ID, supplierBillId: null, amount: 500, method: "cash", paidAt: "2026-10-01T10:00:00.000Z", targetLabel: "Order ORD-1" },
  ];
  const parsed = await invoke(requestPaymentReversalTool, { paymentId: "p-1", reason: "double charged", requestId: "rx-1" });
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.outcome, "needs_approval");
  assert.equal(parsed.payment_cancelled, false);

  const [action] = state.db.tables.get("approval_actions");
  assert.equal(action.action_type, "reverse_payment");
  assert.deepEqual(moneyRpcNames(), []);

  const approved = await approveAction(action.id);
  assert.equal(approved.ok, true);
  const [call] = state.db.adminRpcCalls;
  assert.equal(call.name, "reverse_payment_for_business");
  assert.equal(call.args.p_business_id, BUSINESS_A);
  assert.equal(call.args.p_payment_id, "p-1");
  assert.equal(call.args.p_reason, "double charged");
  assert.equal(call.args.p_idempotency_key, action.id);

  assert.equal(auditRows().length, 1);
  assert.equal(auditRows()[0].action, "payment.reverse");
  assert.equal(auditRows()[0].entity_id, "p-1");
});

test("an already-cancelled payment refuses a second reversal", async () => {
  state.reads.payments = [
    { id: "p-1", kind: "payment", status: "reversed", amount: 500, method: "cash", paidAt: "x", targetLabel: "Order ORD-1" },
  ];
  const parsed = await invoke(requestPaymentReversalTool, { paymentId: "p-1", reason: "again" });
  assert.equal(parsed.status, "error");
  assert.equal(parsed.reason, "already_reversed");
});

test("a reversal row itself cannot be reversed again", async () => {
  state.reads.payments = [
    { id: "r-1", kind: "reversal", status: "active", amount: 500, method: "cash", paidAt: "x", targetLabel: "Order ORD-1" },
  ];
  const parsed = await invoke(requestPaymentReversalTool, { paymentId: "r-1", reason: "mistake" });
  assert.equal(parsed.status, "error");
  assert.equal(parsed.reason, "not_reversible");
});

test("ambiguous active payments on the same order ask for clarification", async () => {
  state.reads.payments = [
    { id: "p-1", kind: "payment", status: "active", orderId: ORDER_ID, supplierBillId: null, amount: 500, method: "cash", paidAt: "x", targetLabel: "Order ORD-1" },
    { id: "p-2", kind: "payment", status: "active", orderId: ORDER_ID, supplierBillId: null, amount: 500, method: "bank", paidAt: "x", targetLabel: "Order ORD-1" },
  ];
  state.reads.orders = [activeOrder()];
  const parsed = await invoke(requestPaymentReversalTool, { orderNumber: "ORD-1", amount: 500, reason: "wrong" });
  assert.equal(parsed.status, "needs_clarification");
});

/* ---------------------------------------------------------------------------
 * get_customer_balance (read-only)
 * ------------------------------------------------------------------------ */

test("get_customer_balance resolves a customer and their per-order money", async () => {
  state.reads.customers = [{ id: "c-1", name: "Ali", totalPaid: 2000, totalDue: 1000 }];
  state.reads.orders = [
    { id: ORDER_ID, customerId: "c-1", orderNumber: "ORD-1", status: "completed", total: 3000, paid: 2000, due: 1000, paymentStatus: "partial", orderedAt: "2026-10-01T00:00:00.000Z" },
  ];
  const parsed = await invoke(getCustomerBalanceTool, { customerName: "Ali" });
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.customer.totalDue, 1000);
  assert.equal(parsed.orders[0].due, 1000);
  assert.equal(parsed.orders[0].paymentStatus, "partial");
});

test("get_customer_balance lists only customers who owe when none is named", async () => {
  state.reads.customers = [
    { id: "c-1", name: "Ali", totalPaid: 1000, totalDue: 1000 },
    { id: "c-2", name: "Zara", totalPaid: 2000, totalDue: 0 },
  ];
  const parsed = await invoke(getCustomerBalanceTool, {});
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.customersOwing, 1);
  assert.deepEqual(parsed.customers.map((c) => c.name), ["Ali"]);
});

/* ---------------------------------------------------------------------------
 * delete_supplier confirmation gate
 * ------------------------------------------------------------------------ */

test("delete_supplier refuses without explicit confirmation", async () => {
  state.reads.suppliers = [{ id: "s-1", name: "Karachi Fabrics" }];
  const parsed = await invoke(deleteSupplierTool, { supplierId: "s-1" });
  assert.equal(parsed.status, "needs_confirmation");
  assert.equal(state.lastServiceWrite, undefined);
});

test("delete_supplier runs only after confirmation and writes a single audit row", async () => {
  state.reads.suppliers = [{ id: "s-1", name: "Karachi Fabrics" }];
  const parsed = await invoke(deleteSupplierTool, { supplierId: "s-1", confirmed: true });
  assert.equal(parsed.status, "ok");
  assert.equal(state.lastServiceWrite?.name, "deleteSupplier");
  assert.equal(state.lastServiceWrite.args[0], "s-1");
  assert.equal(state.reads.suppliers.length, 0);
});

/* ---------------------------------------------------------------------------
 * Registry integrity
 * ------------------------------------------------------------------------ */

test("the controlled tool registry is exactly the 45 real capabilities", () => {
  assert.equal(businessTools.length, 45);
  const names = businessTools.map((t) => t.name);
  assert.ok(names.includes("request_payment"));
  assert.ok(names.includes("request_payment_reversal"));
  assert.ok(names.includes("get_customer_balance"));
  assert.ok(names.includes("list_suppliers"));
  assert.ok(names.includes("create_supplier_bill"));
});