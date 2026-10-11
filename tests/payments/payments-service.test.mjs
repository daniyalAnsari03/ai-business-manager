/**
 * Offline tests for the payments service layer (docs/fix.txt Stage 5):
 *
 *  - validation: every field rule (target, amount, method, dates, lengths,
 *    idempotency key) for record_payment and reverse_payment
 *  - error-code mapping: EVERY RPC error code -> stable reason
 *  - idempotent replays surface as success (never a pretend second write)
 *  - hostile business_id inside user input is ignored
 *  - two-business tenant isolation (A cannot read/change B's money)
 *  - blocked/guarded writes map to their expected reasons
 *
 * The REAL service modules run against an in-memory Supabase fake
 * (tests/payments/register-hooks.mjs), so every query shape and mapping is
 * the production code path.
 */

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { state } from "./stubs/state.mjs";
import { createFakeDb } from "./stubs/fake-supabase.mjs";

import {
  getOrderPaymentSummary,
  listPayments,
  recordPayment,
  reversePayment,
} from "@/lib/payments/service";
import {
  recordPaymentForBusinessServiceRole,
  reversePaymentForBusinessServiceRole,
} from "@/lib/payments/service-role";
import {
  validateRecordPaymentInput,
  validateReversePaymentInput,
} from "@/lib/payments/validation";

export const BUSINESS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const BUSINESS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const SUPPLIER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function paymentRow(overrides = {}) {
  return {
    id: "p-1",
    business_id: BUSINESS_A,
    kind: "payment",
    direction: "in",
    order_id: "o-1",
    supplier_bill_id: null,
    reversal_of: null,
    amount: 500,
    method: "cash",
    paid_at: "2026-10-01T10:00:00.000Z",
    reference: null,
    notes: null,
    idempotency_key: "k-1",
    created_by: "owner-1",
    created_at: "2026-10-01T10:00:00.000Z",
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
    ownerId: "owner-1",
    phone: null,
    address: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  state.user = undefined;
  state.db = createFakeDb({
    suppliers: [
      {
        id: SUPPLIER_ID,
        business_id: BUSINESS_A,
        name: "Karachi Fabrics",
        phone: null,
        email: null,
        address: null,
        payment_terms: null,
        notes: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    supplier_bills: [
      {
        id: "b-1",
        business_id: BUSINESS_A,
        supplier_id: SUPPLIER_ID,
        bill_number: "B-001",
        bill_date: "2026-10-01",
        due_date: null,
        subtotal: 1000,
        discount: 0,
        total: 1000,
        paid_amount: 0,
        due_amount: 1000,
        status: "unpaid",
        notes: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    payments: [paymentRow()],
  });
  state.db.setRpc((name) => {
    if (name === "record_payment") {
      return Promise.resolve({ data: null, error: null });
    }
    if (name === "reverse_payment") {
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  return state.db;
}

function recordSuccessBody(replay = false) {
  return {
    data: {
      ok: true,
      payment: paymentRow({ idempotency_key: "k-record" }),
      idempotent_replay: replay,
      orderId: "o-1",
      supplierBillId: null,
      paid: 500,
      due: 0,
      paidAmount: null,
    },
    error: null,
  };
}

function reverseSuccessBody(replay = false) {
  return {
    data: {
      ok: true,
      payment: paymentRow({
        id: "r-1",
        kind: "reversal",
        direction: "out",
        reversal_of: "p-1",
      }),
      idempotent_replay: replay,
      reversedPaymentId: "p-1",
      orderId: "o-1",
      supplierBillId: null,
      paid: 0,
      due: 0,
      paidAmount: null,
    },
    error: null,
  };
}

beforeEach(() => {
  seed();
});

/* ---------------------------------------------------------------------------
 * Validation: record_payment
 * ------------------------------------------------------------------------ */

test("record_payment validation rejects a non-object", () => {
  const result = validateRecordPaymentInput(null);
  assert.equal(result.ok, false);
  assert.equal(result.fieldErrors.target, "target_required");
});

test("record_payment validation requires exactly one target", () => {
  assert.deepEqual(validateRecordPaymentInput({ amount: 10, method: "cash", idempotencyKey: "k" }).fieldErrors, {
    target: "target_required",
  });
  assert.equal(
    validateRecordPaymentInput({ orderId: "o", supplierBillId: "b", amount: 10, method: "cash", idempotencyKey: "k" })
      .fieldErrors.target,
    "target_ambiguous",
  );
});

test("record_payment validation checks amount", () => {
  const base = { orderId: "o-1", method: "cash", idempotencyKey: "k" };
  assert.equal(validateRecordPaymentInput({ ...base, amount: "500" }).fieldErrors.amount, "not_a_number");
  assert.equal(validateRecordPaymentInput({ ...base, amount: 0 }).fieldErrors.amount, "invalid_amount");
  assert.equal(validateRecordPaymentInput({ ...base, amount: -1 }).fieldErrors.amount, "invalid_amount");
  assert.equal(
    validateRecordPaymentInput({ ...base, amount: 9999999999.99 + 1 }).fieldErrors.amount,
    "invalid_amount",
  );
  assert.equal(validateRecordPaymentInput({ ...base, amount: 500 }).ok, true);
});

test("record_payment validation checks method, dates and lengths", () => {
  const base = { orderId: "o-1", amount: 500, idempotencyKey: "k" };
  assert.equal(validateRecordPaymentInput({ ...base, method: "bitcoin" }).fieldErrors.method, "invalid_method");
  assert.equal(
    validateRecordPaymentInput({ ...base, method: "cash", paidAt: "yesterday" }).fieldErrors.paidAt,
    "invalid_iso_date",
  );
  assert.equal(
    validateRecordPaymentInput({ ...base, method: "cash", reference: "x".repeat(201) }).fieldErrors.reference,
    "too_long",
  );
  assert.equal(
    validateRecordPaymentInput({ ...base, method: "cash", notes: "x".repeat(1001) }).fieldErrors.notes,
    "too_long",
  );
  assert.equal(
    validateRecordPaymentInput({ ...base, method: "cash", idempotencyKey: " " }).fieldErrors.idempotencyKey,
    "required",
  );
  assert.equal(
    validateRecordPaymentInput({ ...base, method: "cash", idempotencyKey: "x".repeat(161) }).fieldErrors
      .idempotencyKey,
    "too_long",
  );
});

test("record_payment validation trims and rounds a valid payload", () => {
  const result = validateRecordPaymentInput({
    orderId: "  o-1  ",
    amount: 500.004,
    method: "jazzcash",
    paidAt: "2026-10-01T12:30:00Z",
    reference: "  chk-1  ",
    notes: " ",
    idempotencyKey: " key ",
  });
  assert.equal(result.ok, true);
  const value = result.value;
  assert.equal(value.orderId, "o-1");
  assert.equal(value.amount, 500);
  assert.equal(value.supplierBillId, null);
  assert.equal(value.reference, "chk-1");
  assert.equal(value.notes, null);
  assert.equal(value.idempotencyKey, "key");
});

/* ---------------------------------------------------------------------------
 * Validation: reverse_payment
 * ------------------------------------------------------------------------ */

test("reverse_payment validation requires paymentId, reason and key", () => {
  assert.equal(validateReversePaymentInput(null).fieldErrors.paymentId, "required");
  const noReason = validateReversePaymentInput({ paymentId: "p-1", idempotencyKey: "k" });
  assert.equal(noReason.fieldErrors.reason, "required");
  const noKey = validateReversePaymentInput({ paymentId: "p-1", reason: "wrong amount" });
  assert.equal(noKey.fieldErrors.idempotencyKey, "required");
  const tooLongReason = validateReversePaymentInput({ paymentId: "p-1", reason: "x".repeat(501), idempotencyKey: "k" });
  assert.equal(tooLongReason.fieldErrors.reason, "too_long");
});

test("reverse_payment validation accepts a valid payload", () => {
  const result = validateReversePaymentInput({ paymentId: "  p-1 ", reason: "  double charged ", idempotencyKey: "r1" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { paymentId: "p-1", reason: "double charged", idempotencyKey: "r1" });
});

/* ---------------------------------------------------------------------------
 * Error-code mapping: EVERY money RPC code -> stable reason
 * ------------------------------------------------------------------------ */

const RECORD_ERROR_MAP = [
  ["NO_BUSINESS", "no_business"],
  ["NOT_FOUND", "not_found"],
  ["TARGET_REQUIRED", "target_required"],
  ["TARGET_AMBIGUOUS", "target_ambiguous"],
  ["ORDER_INVALID", "order_invalid"],
  ["BILL_INVALID", "bill_invalid"],
  ["INVALID_AMOUNT", "invalid_amount"],
  ["INVALID_METHOD", "invalid_method"],
  ["INVALID_REFERENCE", "invalid_reference"],
  ["INVALID_NOTES", "invalid_notes"],
  ["INVALID_REASON", "invalid_reason"],
  ["IDEMPOTENCY_KEY_REQUIRED", "idempotency_key_required"],
  ["IDEMPOTENCY_CONFLICT", "idempotency_conflict"],
  ["ORDER_CANCELLED", "order_cancelled"],
  ["NO_DUE", "no_due"],
  ["OVERPAYMENT", "overpayment"],
  ["HAS_PAYMENTS", "has_payments"],
  ["NOT_REVERSIBLE", "not_reversible"],
  ["ALREADY_REVERSED", "already_reversed"],
  ["NEGATIVE_PAID", "negative_paid"],
  ["ACTOR_REQUIRED", "actor_required"],
  ["THIS_IS_NOT_A_CODE", "database_error"],
];

test("record_payment maps every RPC code to the stable reason", async () => {
  for (const [code, reason] of RECORD_ERROR_MAP) {
    state.db.setRpc(() => Promise.resolve({ data: { ok: false, error: code }, error: null }));
    const result = await recordPayment({ orderId: "o-1", amount: 500, method: "cash", idempotencyKey: "k" });
    assert.equal(result.ok, false, `code ${code}`);
    assert.equal(result.reason, reason, `code ${code}`);
  }
});

test("record_payment treats RPC-level errors and empty bodies as database_error", async () => {
  state.db.setRpc(() => Promise.resolve({ data: null, error: { message: "boom" } }));
  assert.equal((await recordPayment({ orderId: "o-1", amount: 500, method: "cash", idempotencyKey: "k" })).reason, "database_error");
  state.db.setRpc(() => Promise.resolve({ data: null, error: null }));
  assert.equal((await recordPayment({ orderId: "o-1", amount: 500, method: "cash", idempotencyKey: "k" })).reason, "database_error");
});

test("reverse_payment maps its codes including reversed/negative cases", async () => {
  for (const [code, reason] of [
    ["ALREADY_REVERSED", "already_reversed"],
    ["NOT_REVERSIBLE", "not_reversible"],
    ["NEGATIVE_PAID", "negative_paid"],
    ["INVALID_REASON", "invalid_reason"],
    ["OVERPAYMENT", "overpayment"],
    ["IDEMPOTENCY_CONFLICT", "idempotency_conflict"],
    ["BOGUS_CODE", "database_error"],
  ]) {
    state.db.setRpc(() => Promise.resolve({ data: { ok: false, error: code }, error: null }));
    const result = await reversePayment({ paymentId: "p-1", reason: "double charged", idempotencyKey: "r1" });
    assert.equal(result.ok, false, `code ${code}`);
    assert.equal(result.reason, reason, `code ${code}`);
  }
});

/* ---------------------------------------------------------------------------
 * Success + idempotent replay
 * ------------------------------------------------------------------------ */

test("record_payment success returns the mapped payment and money", async () => {
  state.db.setRpc(() => Promise.resolve(recordSuccessBody(false)));
  const result = await recordPayment({ orderId: "o-1", amount: 500, method: "cash", idempotencyKey: "k-record" });
  assert.equal(result.ok, true);
  assert.equal(result.data.idempotentReplay, false);
  assert.equal(result.data.payment.amount, 500);
  assert.equal(result.data.payment.kind, "payment");
  assert.equal(result.data.orderId, "o-1");
  assert.equal(result.data.due, 0);
});

test("record_payment idempotent replay is a success, never a second write", async () => {
  state.db.setRpc(() => Promise.resolve(recordSuccessBody(true)));
  const result = await recordPayment({ orderId: "o-1", amount: 500, method: "cash", idempotencyKey: "k-record" });
  assert.equal(result.ok, true);
  assert.equal(result.data.idempotentReplay, true);
});

test("reverse_payment idempotent replay is a success", async () => {
  state.db.setRpc(() => Promise.resolve(reverseSuccessBody(true)));
  const result = await reversePayment({ paymentId: "p-1", reason: "double charged", idempotencyKey: "r1" });
  assert.equal(result.ok, true);
  assert.equal(result.data.idempotentReplay, true);
  assert.equal(result.data.reversedPaymentId, "p-1");
  assert.equal(result.data.payment.kind, "reversal");
});

/* ---------------------------------------------------------------------------
 * Hostile input + tenant isolation
 * ------------------------------------------------------------------------ */

test("record_payment ignores a hostile business_id inside the payload", async () => {
  state.db.setRpc(() => Promise.resolve(recordSuccessBody(false)));
  const result = await recordPayment({
    orderId: "o-1",
    amount: 500,
    method: "cash",
    idempotencyKey: "k-record",
    business_id: BUSINESS_B,
    businessId: BUSINESS_B,
  });
  assert.equal(result.ok, true);
  const call = state.db.rpcCalls.find((c) => c.name === "record_payment");
  assert.equal(call.args.p_payload.business_id, undefined);
  assert.equal(call.args.p_payload.businessId, undefined);
  assert.equal(call.args.p_payload.orderId, "o-1");
});

test("every payments query is scoped to the session business", async () => {
  await listPayments();
  // Every query against a business-owned table must carry an
  // eq("business_id", session tenant) filter — the service gets the tenant
  // from the authenticated session, never from client input.
  const paymentTableCalls = state.db.fromCalls.filter((c) => c.table === "payments");
  assert.ok(paymentTableCalls.length > 0);
  for (const call of paymentTableCalls) {
    assert.equal(call.businessId, BUSINESS_A);
  }
  // After switching tenants, the same call can no longer see A's rows.
  state.business = { ...state.business, id: BUSINESS_B };
  const other = await listPayments();
  assert.equal(other.ok, true);
  assert.deepEqual(other.data, []);
});

test("listPayments returns ledger entries with reversed status and labels", async () => {
  state.db.tables.set("orders", [
    { id: "o-1", business_id: BUSINESS_A, order_number: "ORD-1", customer_id: "c-1", status: "completed" },
  ]);
  state.db.tables.set("payments", [
    paymentRow(),
    paymentRow({
      id: "r-1",
      kind: "reversal",
      direction: "out",
      reversal_of: "p-1",
    }),
  ]);
  const result = await listPayments({ orderId: "o-1" });
  assert.equal(result.ok, true);
  assert.equal(result.data.length, 2);
  const [payment, reversal] = result.data;
  assert.equal(payment.status, "reversed"); // reversed by the reversal row
  assert.equal(payment.targetLabel, "ORD-1");
  assert.equal(reversal.kind, "reversal");
  assert.equal(reversal.status, "active");
  assert.equal(reversal.targetLabel, "ORD-1");
});

test("getOrderPaymentSummary maps numeric strings to numbers", async () => {
  state.db.setRpc(() =>
    Promise.resolve({
      data: {
        ok: true,
        order_id: "o-1",
        order_number: "ORD-1",
        customer_id: "c-1",
        status: "completed",
        ordered_at: "2026-10-01",
        total: "1000",
        opening_paid: "0",
        net_paid: "500",
        paid: "500",
        due: "500",
        payment_count: 1,
      },
      error: null,
    }),
  );
  const result = await getOrderPaymentSummary("o-1");
  assert.equal(result.ok, true);
  assert.equal(result.data.total, 1000);
  assert.equal(result.data.due, 500);
  assert.equal(result.data.paid, 500);
  assert.equal(result.data.status, "completed");
});

/* ---------------------------------------------------------------------------
 * Service-role writers (approval executor path)
 * ------------------------------------------------------------------------ */

function seedWithServiceRoleRpc() {
  const db = state.db;
  db.setAdminRpc((name) => {
    if (name === "record_payment_for_business") {
      return Promise.resolve(recordSuccessBody(false));
    }
    if (name === "reverse_payment_for_business") {
      return Promise.resolve(reverseSuccessBody(false));
    }
    return Promise.resolve({ data: null, error: null });
  });
  return db;
}

test("service-role record uses the verified business id and actor", async () => {
  const db = seedWithServiceRoleRpc();
  const result = await recordPaymentForBusinessServiceRole({
    businessId: BUSINESS_A,
    actorId: "owner-1",
    payload: { orderId: "o-1", amount: 500, method: "cash", idempotencyKey: "action-1" },
  });
  assert.equal(result.ok, true);
  const call = db.adminRpcCalls.find((c) => c.name === "record_payment_for_business");
  assert.equal(call.args.p_business_id, BUSINESS_A);
  assert.equal(call.args.p_actor, "owner-1");
  assert.equal(call.args.p_payload.idempotencyKey, "action-1");
});

test("service-role reverse passes payment id, reason and stable key", async () => {
  const db = seedWithServiceRoleRpc();
  const result = await reversePaymentForBusinessServiceRole({
    businessId: BUSINESS_A,
    actorId: "owner-1",
    paymentId: "p-1",
    reason: "double charged",
    idempotencyKey: "action-2",
  });
  assert.equal(result.ok, true);
  const call = db.adminRpcCalls.find((c) => c.name === "reverse_payment_for_business");
  assert.equal(call.args.p_business_id, BUSINESS_A);
  assert.equal(call.args.p_payment_id, "p-1");
  assert.equal(call.args.p_reason, "double charged");
  assert.equal(call.args.p_idempotency_key, "action-2");
});

test("service-role maps its own codes and never runs without an admin client", async () => {
  const db = seedWithServiceRoleRpc();
  db.setAdminRpc((name) => {
    if (name === "record_payment_for_business") {
      return Promise.resolve({ data: { ok: false, error: "ALREADY_REVERSED" }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  const result = await recordPaymentForBusinessServiceRole({
    businessId: BUSINESS_A,
    actorId: "owner-1",
    payload: { orderId: "o-1", amount: 500, method: "cash", idempotencyKey: "action-1" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "already_reversed");

  db.nextAdminUnavailable = true;
  const noAdmin = await reversePaymentForBusinessServiceRole({
    businessId: BUSINESS_A,
    actorId: "owner-1",
    paymentId: "p-1",
    reason: "why",
    idempotencyKey: "action-2",
  });
  assert.equal(noAdmin.ok, false);
  assert.equal(noAdmin.reason, "database_error");
});