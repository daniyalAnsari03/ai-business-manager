import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import {
  validateRecordPaymentInput,
  validateReversePaymentInput,
} from "@/lib/payments/validation";
import type {
  OrderPaymentSummary,
  Payment,
  PaymentLedgerEntry,
  RecordPaymentInput,
  RecordPaymentResult,
  ReversePaymentInput,
  ReversePaymentResult,
} from "@/lib/payments/types";

/**
 * Payments ledger service layer — the ONLY place in the app that calls the
 * money RPCs (`record_payment` / `reverse_payment`) from an authenticated
 * session. Those RPCs resolve business_id and actor from `auth.uid()`, so no
 * code path here can even name a business. Reads are RLS-protected SELECTs.
 *
 * The service-role variants (`record_payment_for_business` /
 * `reverse_payment_for_business`) are NOT exported from this module. They live
 * in `lib/payments/service-role.ts` and are used only by the approval
 * executor, which already holds a server-verified business id.
 */

export type PaymentServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "not_found"
  | "target_required"
  | "target_ambiguous"
  | "order_invalid"
  | "bill_invalid"
  | "invalid_amount"
  | "invalid_method"
  | "invalid_reference"
  | "invalid_notes"
  | "invalid_reason"
  | "idempotency_key_required"
  | "idempotency_conflict"
  | "order_cancelled"
  | "no_due"
  | "overpayment"
  | "has_payments"
  | "not_reversible"
  | "already_reversed"
  | "negative_paid"
  | "actor_required"
  | "database_error";

export type PaymentServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: PaymentServiceError };

interface PaymentRow {
  id: string;
  business_id: string;
  kind: string;
  direction: string;
  order_id: string | null;
  supplier_bill_id: string | null;
  reversal_of: string | null;
  amount: string | number;
  method: string;
  paid_at: string;
  reference: string | null;
  notes: string | null;
  idempotency_key: string;
  created_by: string;
  created_at: string;
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseFloat(value) || 0;
}

function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    businessId: row.business_id,
    kind: row.kind as Payment["kind"],
    direction: row.direction as Payment["direction"],
    orderId: row.order_id,
    supplierBillId: row.supplier_bill_id,
    reversalOf: row.reversal_of,
    amount: toNumber(row.amount),
    method: row.method as Payment["method"],
    paidAt: row.paid_at,
    reference: row.reference,
    notes: row.notes,
    idempotencyKey: row.idempotency_key,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

type RpcError = string | null | undefined;

/** Maps a money-RPC `error` code to a stable reason the UI can localise. */
function mapRpcError(code: RpcError): PaymentServiceError {
  switch (code) {
    case "NO_BUSINESS":
      return "no_business";
    case "NOT_FOUND":
      return "not_found";
    case "TARGET_REQUIRED":
      return "target_required";
    case "TARGET_AMBIGUOUS":
      return "target_ambiguous";
    case "ORDER_INVALID":
      return "order_invalid";
    case "BILL_INVALID":
      return "bill_invalid";
    case "INVALID_AMOUNT":
      return "invalid_amount";
    case "INVALID_METHOD":
      return "invalid_method";
    case "INVALID_REFERENCE":
      return "invalid_reference";
    case "INVALID_NOTES":
      return "invalid_notes";
    case "INVALID_REASON":
      return "invalid_reason";
    case "IDEMPOTENCY_KEY_REQUIRED":
      return "idempotency_key_required";
    case "IDEMPOTENCY_CONFLICT":
      return "idempotency_conflict";
    case "ORDER_CANCELLED":
      return "order_cancelled";
    case "NO_DUE":
      return "no_due";
    case "OVERPAYMENT":
      return "overpayment";
    case "HAS_PAYMENTS":
      return "has_payments";
    case "NOT_REVERSIBLE":
      return "not_reversible";
    case "ALREADY_REVERSED":
      return "already_reversed";
    case "NEGATIVE_PAID":
      return "negative_paid";
    case "ACTOR_REQUIRED":
      return "actor_required";
    default:
      return "database_error";
  }
}

interface RpcBody {
  ok?: boolean;
  error?: string;
}

/** Parses an `{ ok: true, ... } | { ok: false, error: "CODE" }` jsonb result. */
function readRpc<R>(result: {
  data: unknown;
  error: unknown;
}): PaymentServiceResult<R> {
  if (result.error) return { ok: false, reason: "database_error" };
  const raw = result.data;
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "database_error" };
  }
  const body = raw as RpcBody;
  if (body.ok === false) return { ok: false, reason: mapRpcError(body.error) };
  return { ok: true, data: raw as R };
}

interface OrderNumberRow {
  id: string;
  order_number: string;
}

interface BillTargetRow {
  id: string;
  supplier_id: string;
  bill_number: string | null;
}

async function requireBusinessContext(): Promise<
  { ok: true; supabase: SupabaseClient; business: Business } | { ok: false; reason: PaymentServiceError }
> {
  let user;
  let supabase: SupabaseClient;
  try {
    user = await getServerUser();
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }
  if (!user) return { ok: false, reason: "unauthenticated" };

  const business = await getUserBusiness();
  if (!business) return { ok: false, reason: "no_business" };
  return { ok: true, supabase, business };
}

/** Loads order numbers for the given order ids (RLS-scoped to this business). */
async function loadOrderLabels(
  supabase: SupabaseClient,
  businessId: string,
  orderIds: string[],
): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map();
  const { data } = await supabase
    .from("orders")
    .select("id, order_number")
    .eq("business_id", businessId)
    .in("id", orderIds);
  return new Map(
    ((data ?? []) as OrderNumberRow[]).map((row) => [
      row.id,
      row.order_number,
    ]),
  );
}

/** Loads supplier-name labels for the given bill ids (RLS-scoped). */
async function loadBillLabels(
  supabase: SupabaseClient,
  businessId: string,
  billIds: string[],
): Promise<Map<string, string>> {
  if (billIds.length === 0) return new Map();
  const { data: bills } = await supabase
    .from("supplier_bills")
    .select("id, supplier_id, bill_number")
    .eq("business_id", businessId)
    .in("id", billIds);
  const rows = (bills ?? []) as BillTargetRow[];
  const supplierIds = [...new Set(rows.map((r) => r.supplier_id))];

  const { data: suppliers } =
    supplierIds.length > 0
      ? await supabase
          .from("suppliers")
          .select("id, name")
          .eq("business_id", businessId)
          .in("id", supplierIds)
      : { data: [] };
  const names = new Map(
    ((suppliers ?? []) as Array<{ id: string; name: string }>).map((s) => [
      s.id,
      s.name,
    ]),
  );

  return new Map(
    rows.map((row) => {
      const label = row.bill_number?.trim() ? `${names.get(row.supplier_id) ?? "—"} · ${row.bill_number}` : names.get(row.supplier_id) ?? "—";
      return [row.id, label];
    }),
  );
}

/**
 * The `record_payment` RPC answers with the snake_case `idempotent_replay` and
 * `net_paid` keys (alongside the camelCase `paidAmount`/`orderId`), so the
 * service normalizes them to the camelCase shape the rest of the app uses.
 */
interface RawPaymentResult {
  payment?: PaymentRow;
  idempotent_replay?: boolean;
  net_paid?: number | string;
  orderId?: string | null;
  supplierBillId?: string | null;
  paid?: number;
  due?: number;
  paidAmount?: number;
}

interface RawReversePaymentResult extends RawPaymentResult {
  reversedPaymentId?: string;
}

function normalizeNetPaid(value: number | string | undefined): number | undefined {
  return value === undefined ? undefined : toNumber(value);
}

export interface ListPaymentsOptions {
  direction?: Payment["direction"];
  orderId?: string;
  supplierBillId?: string;
  recentOnly?: boolean;
}

/**
 * Ledger rows for the caller's business, newest first, each marked with its
 * reversed status and a human label for its target (order number / bill).
 * Never returns another business's money.
 */
export async function listPayments(
  options: ListPaymentsOptions = {},
): Promise<PaymentServiceResult<PaymentLedgerEntry[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  let query = context.supabase
    .from("payments")
    .select("*")
    .eq("business_id", context.business.id)
    .order("created_at", { ascending: false });

  if (options.direction) query = query.eq("direction", options.direction);
  if (options.orderId) query = query.eq("order_id", options.orderId);
  if (options.supplierBillId) query = query.eq("supplier_bill_id", options.supplierBillId);
  if (options.recentOnly) query = query.limit(20);

  const { data: rows, error } = await query;
  if (error) return { ok: false, reason: "database_error" };

  const payments = (rows ?? []) as PaymentRow[];
  if (payments.length === 0) return { ok: true, data: [] };

  // One pass to learn which payments have been reversed.
  const reversalIds = new Set<string>();
  const { data: reversalRows } = await context.supabase
    .from("payments")
    .select("reversal_of")
    .eq("business_id", context.business.id)
    .not("reversal_of", "is", null);
  for (const row of (reversalRows ?? []) as Array<{ reversal_of: string }>) {
    reversalIds.add(row.reversal_of);
  }

  const orderIds = [
    ...new Set(payments.map((p) => p.order_id).filter((v): v is string => !!v)),
  ];
  const billIds = [
    ...new Set(
      payments.map((p) => p.supplier_bill_id).filter((v): v is string => !!v),
    ),
  ];

  const [orderLabels, billLabels] = await Promise.all([
    loadOrderLabels(context.supabase, context.business.id, orderIds),
    loadBillLabels(context.supabase, context.business.id, billIds),
  ]);

  const entries: PaymentLedgerEntry[] = payments.map((row) => {
    const payment = mapPayment(row);
    return {
      ...payment,
      status: reversalIds.has(payment.id) ? "reversed" : "active",
      targetLabel: payment.orderId
        ? orderLabels.get(payment.orderId) ?? null
        : payment.supplierBillId
          ? billLabels.get(payment.supplierBillId) ?? null
          : null,
    };
  });

  return { ok: true, data: entries };
}

export async function getPayment(
  paymentId: string,
): Promise<PaymentServiceResult<PaymentLedgerEntry>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data: row, error } = await context.supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .eq("business_id", context.business.id)
    .maybeSingle();

  if (error) return { ok: false, reason: "database_error" };
  if (!row) return { ok: false, reason: "not_found" };

  const payment = mapPayment(row as PaymentRow);
  const { data: reversalRows } = await context.supabase
    .from("payments")
    .select("reversal_of")
    .eq("business_id", context.business.id)
    .eq("reversal_of", payment.id);
  const status = (reversalRows ?? []).length > 0 ? "reversed" : "active";

  let targetLabel: string | null = null;
  if (payment.orderId) {
    const labels = await loadOrderLabels(context.supabase, context.business.id, [
      payment.orderId,
    ]);
    targetLabel = labels.get(payment.orderId) ?? null;
  } else if (payment.supplierBillId) {
    const labels = await loadBillLabels(context.supabase, context.business.id, [
      payment.supplierBillId,
    ]);
    targetLabel = labels.get(payment.supplierBillId) ?? null;
  }

  return { ok: true, data: { ...payment, status, targetLabel } };
}

/**
 * Records a payment against an order (customer money in) or a supplier bill
 * (supplier money out). Exactly one target; direction is implied by target.
 */
export async function recordPayment(
  input: unknown,
): Promise<PaymentServiceResult<RecordPaymentResult>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateRecordPaymentInput(input);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  const payload = validated.value as RecordPaymentInput;
  const { data, error } = await context.supabase.rpc("record_payment", {
    p_payload: {
      orderId: payload.orderId ?? undefined,
      supplierBillId: payload.supplierBillId ?? undefined,
      amount: payload.amount,
      method: payload.method,
      paidAt: payload.paidAt ?? undefined,
      reference: payload.reference ?? undefined,
      notes: payload.notes ?? undefined,
      idempotencyKey: payload.idempotencyKey,
    },
  });

  const result = readRpc<RawPaymentResult>({ data, error });
  if (!result.ok) return result;

  const { payment, idempotent_replay, net_paid, ...rest } = result.data;
  return {
    ok: true,
    data: {
      payment: payment ? mapPayment(payment) : (null as unknown as Payment),
      idempotentReplay: idempotent_replay === true,
      orderId: rest.orderId ?? null,
      supplierBillId: rest.supplierBillId ?? null,
      netPaid: normalizeNetPaid(net_paid),
      paid: rest.paid,
      due: rest.due,
      paidAmount: rest.paidAmount,
    },
  };
}

/**
 * Reverses a payment by inserting a mirror reversal row (the ledger is
 * append-only). Idempotent: retrying with the same key replays, never dupes.
 */
export async function reversePayment(
  input: unknown,
): Promise<PaymentServiceResult<ReversePaymentResult>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateReversePaymentInput(input);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  const { paymentId, reason, idempotencyKey } = validated.value as ReversePaymentInput;
  const { data, error } = await context.supabase.rpc("reverse_payment", {
    p_payment_id: paymentId,
    p_reason: reason,
    p_idempotency_key: idempotencyKey,
  });

  const result = readRpc<RawReversePaymentResult>({ data, error });
  if (!result.ok) return result;

  const { payment, idempotent_replay, net_paid, ...rest } = result.data;
  return {
    ok: true,
    data: {
      payment: payment ? mapPayment(payment) : (null as unknown as Payment),
      idempotentReplay: idempotent_replay === true,
      reversedPaymentId: rest.reversedPaymentId ?? "",
      orderId: rest.orderId ?? null,
      supplierBillId: rest.supplierBillId ?? null,
      netPaid: normalizeNetPaid(net_paid),
      paid: rest.paid,
      due: rest.due,
      paidAmount: rest.paidAmount,
    },
  };
}

interface SummaryRow {
  order_id: string;
  order_number: string;
  customer_id: string;
  status: string;
  ordered_at: string;
  total: string | number;
  opening_paid: string | number;
  net_paid: string | number;
  paid: string | number;
  due: string | number;
  payment_count: number;
}

function mapSummary(row: SummaryRow): OrderPaymentSummary {
  return {
    orderId: row.order_id,
    orderNumber: row.order_number,
    customerId: row.customer_id,
    status: row.status,
    orderedAt: row.ordered_at,
    total: toNumber(row.total),
    openingPaid: toNumber(row.opening_paid),
    netPaid: toNumber(row.net_paid),
    paid: toNumber(row.paid),
    due: toNumber(row.due),
    paymentCount: row.payment_count ?? 0,
  };
}

/** Customer-side money for one order (single-source read from the ledger). */
export async function getOrderPaymentSummary(
  orderId: string,
): Promise<PaymentServiceResult<OrderPaymentSummary>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase.rpc("get_order_payment_summary", {
    p_order_id: orderId,
  });
  const result = readRpc<SummaryRow>({ data, error });
  if (!result.ok) return result;
  return { ok: true, data: mapSummary(result.data) };
}

/** Receivables for every order of the caller's business (RLS-secured). */
export async function listOrderPaymentSummaries(): Promise<
  PaymentServiceResult<OrderPaymentSummary[]>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase.rpc(
    "list_order_payment_summaries",
  );
  if (error) return { ok: false, reason: "database_error" };
  const rows = (data ?? []) as SummaryRow[];
  return { ok: true, data: rows.map(mapSummary) };
}