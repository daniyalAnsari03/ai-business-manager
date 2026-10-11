/**
 * Offline tests for the pure UI decision helpers (docs/fix.txt Stage 5,
 * "UI helper tests: menu item rules, payment form validation and amount
 * defaults, status chip derivation"). These helpers are the SAME functions the
 * payment screens import, so a passing test is a guarantee about the real UI.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { paymentCancelState, paymentFormAmountDefault } from "@/lib/payments/ui-helpers";
import { isPaymentMethod, orderPaymentStatus, PAYMENT_METHODS } from "@/lib/payments/types";
import { validateRecordPaymentInput } from "@/lib/payments/validation";

function entry(overrides = {}) {
  return {
    id: "p-1",
    businessId: "b-1",
    kind: "payment",
    direction: "in",
    orderId: null,
    supplierBillId: null,
    reversalOf: null,
    amount: 500,
    method: "cash",
    paidAt: "2026-10-01T00:00:00.000Z",
    reference: null,
    notes: null,
    idempotencyKey: "k",
    createdBy: "u",
    createdAt: "2026-10-01T00:00:00.000Z",
    status: "active",
    targetLabel: null,
    ...overrides,
  };
}

/* ---------------------------------------------------------------------------
 * Menu item rules (paymentCancelState)
 * ------------------------------------------------------------------------ */

test("an active payment row offers Cancel", () => {
  assert.deepEqual(paymentCancelState(entry()), {
    cancelDisabled: false,
    cancelDisabledReason: null,
  });
});

test("a reversal row has nothing to cancel", () => {
  const state = paymentCancelState(entry({ kind: "reversal", direction: "out", reversalOf: "p-0" }));
  assert.equal(state.cancelDisabled, true);
  assert.equal(state.cancelDisabledReason, "reversal");
});

test("an already-cancelled payment cannot be cancelled again", () => {
  const state = paymentCancelState(entry({ status: "reversed", reversalOf: "r-x" }));
  assert.equal(state.cancelDisabled, true);
  assert.equal(state.cancelDisabledReason, "reversed");
});

test("a cancelled reversal row reports the reversal reason (kind wins)", () => {
  const state = paymentCancelState(entry({ kind: "reversal", direction: "out", reversalOf: "p-0", status: "reversed" }));
  assert.equal(state.cancelDisabledReason, "reversal");
});

test("the record form amount default is the full outstanding due", () => {
  assert.equal(paymentFormAmountDefault(500), "500");
  assert.equal(paymentFormAmountDefault(0), "0");
  assert.equal(paymentFormAmountDefault(500.25), "500.25");
});

/* ---------------------------------------------------------------------------
 * Status chip derivation (orderPaymentStatus — used by the orders list chip)
 * ------------------------------------------------------------------------ */

test("orderPaymentStatus derives unpaid/partial/paid", () => {
  assert.equal(orderPaymentStatus({ total: 1000, paid: 0 }), "unpaid");
  assert.equal(orderPaymentStatus({ total: 1000, paid: 400 }), "partial");
  assert.equal(orderPaymentStatus({ total: 1000, paid: 1000 }), "paid");
  assert.equal(orderPaymentStatus({ total: 1000, paid: 1200 }), "paid"); // overpayments still show paid
});

/* ---------------------------------------------------------------------------
 * Payment form validation + method constants
 * ------------------------------------------------------------------------ */

test("PAYMENT_METHODS is the UI select's exact list", () => {
  assert.deepEqual(PAYMENT_METHODS, ["cash", "bank", "easypaisa", "jazzcash", "cheque", "other"]);
});

test("isPaymentMethod accepts only the known methods", () => {
  for (const method of PAYMENT_METHODS) assert.equal(isPaymentMethod(method), true);
  assert.equal(isPaymentMethod("bitcoin"), false);
  assert.equal(isPaymentMethod(undefined), false);
  assert.equal(isPaymentMethod(""), false);
  assert.equal(isPaymentMethod("Cash"), false); // case matters
});

test("record form validation keeps the default amount acceptable", () => {
  const result = validateRecordPaymentInput({
    orderId: "o-1",
    amount: Number(paymentFormAmountDefault(500)),
    method: "cash",
    idempotencyKey: "k",
  });
  assert.equal(result.ok, true);
});