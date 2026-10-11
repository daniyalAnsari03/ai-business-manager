/**
 * Boundary validation for the two money operations an owner (or the AI on
 * their behalf) can request: recording a payment and reversing one. Pure
 * functions only; the database RPCs re-validate everything under the row lock.
 */

import {
  isPaymentMethod,
  type RecordPaymentInput,
  type ReversePaymentInput,
} from "@/lib/payments/types";

export const PAYMENT_LIMITS = {
  amountMax: 9999999999.99,
  referenceMax: 200,
  notesMax: 1000,
  reasonMax: 500,
  idempotencyKeyMax: 160,
} as const;

export type PaymentField =
  | "target"
  | "amount"
  | "method"
  | "paidAt"
  | "reference"
  | "notes"
  | "idempotencyKey";

export type PaymentFieldError =
  | "required"
  | "too_long"
  | "invalid_amount"
  | "not_a_number"
  | "invalid_method"
  | "invalid_iso_date"
  | "target_required"
  | "target_ambiguous";

export type PaymentFieldErrors = Partial<Record<PaymentField, PaymentFieldError>>;

export type RecordPaymentValidationResult =
  | { ok: true; value: RecordPaymentInput }
  | { ok: false; fieldErrors: PaymentFieldErrors };

export type ReversePaymentFieldErrors = Partial<
  Record<"paymentId" | "reason" | "idempotencyKey", PaymentFieldError>
>;

export type ReversePaymentValidationResult =
  | { ok: true; value: ReversePaymentInput }
  | { ok: false; fieldErrors: ReversePaymentFieldErrors };

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown, max: number): string | null | "too_long" {
  if (value === null || value === undefined || typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? "too_long" : trimmed;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

export function validateRecordPaymentInput(
  input: unknown,
): RecordPaymentValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, fieldErrors: { target: "target_required" } };
  }

  const raw = input as Record<string, unknown>;
  const fieldErrors: PaymentFieldErrors = {};

  const orderId = asTrimmedString(raw.orderId ?? "");
  const supplierBillId = asTrimmedString(raw.supplierBillId ?? "");
  const hasOrder = orderId.length > 0;
  const hasBill = supplierBillId.length > 0;
  if (!hasOrder && !hasBill) fieldErrors.target = "target_required";
  else if (hasOrder && hasBill) fieldErrors.target = "target_ambiguous";

  const amount = typeof raw.amount === "number" ? raw.amount : NaN;
  if (!Number.isFinite(amount)) {
    fieldErrors.amount = "not_a_number";
  } else if (amount <= 0 || amount > PAYMENT_LIMITS.amountMax) {
    fieldErrors.amount = "invalid_amount";
  }

  if (!isPaymentMethod(raw.method)) fieldErrors.method = "invalid_method";

  const paidAtRaw = optionalText(raw.paidAt ?? "", 40);
  if (paidAtRaw === "too_long") {
    fieldErrors.paidAt = "invalid_iso_date";
  } else if (paidAtRaw !== null && !isValidIsoDate(paidAtRaw)) {
    fieldErrors.paidAt = "invalid_iso_date";
  }

  const reference = optionalText(raw.reference, PAYMENT_LIMITS.referenceMax);
  if (reference === "too_long") fieldErrors.reference = "too_long";

  const notes = optionalText(raw.notes, PAYMENT_LIMITS.notesMax);
  if (notes === "too_long") fieldErrors.notes = "too_long";

  const idempotencyKey = asTrimmedString(raw.idempotencyKey);
  if (idempotencyKey.length === 0) fieldErrors.idempotencyKey = "required";
  else if (idempotencyKey.length > PAYMENT_LIMITS.idempotencyKeyMax) {
    fieldErrors.idempotencyKey = "too_long";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: {
      orderId: hasOrder ? orderId : null,
      supplierBillId: hasBill ? supplierBillId : null,
      amount: round2(amount),
      method: raw.method as RecordPaymentInput["method"],
      paidAt: paidAtRaw === "too_long" ? null : paidAtRaw,
      reference: reference === "too_long" ? null : reference,
      notes: notes === "too_long" ? null : notes,
      idempotencyKey,
    },
  };
}

export function validateReversePaymentInput(
  input: unknown,
): ReversePaymentValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, fieldErrors: { paymentId: "required" } };
  }

  const raw = input as Record<string, unknown>;
  const fieldErrors: ReversePaymentFieldErrors = {};

  const paymentId = asTrimmedString(raw.paymentId);
  if (paymentId.length === 0) fieldErrors.paymentId = "required";

  const reason = asTrimmedString(raw.reason);
  if (reason.length === 0) fieldErrors.reason = "required";
  else if (reason.length > PAYMENT_LIMITS.reasonMax) fieldErrors.reason = "too_long";

  const idempotencyKey = asTrimmedString(raw.idempotencyKey);
  if (idempotencyKey.length === 0) fieldErrors.idempotencyKey = "required";
  else if (idempotencyKey.length > PAYMENT_LIMITS.idempotencyKeyMax) {
    fieldErrors.idempotencyKey = "too_long";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: { paymentId, reason, idempotencyKey },
  };
}