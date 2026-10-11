/**
 * Boundary validation for supplier bill payloads. Pure functions only.
 * The server RPC (`create_supplier_bill` / `update_supplier_bill`)
 * re-validates everything authoritatively and is the final word — this file
 * exists so the form gets instant, consistent feedback without a round trip.
 */

import type { SupplierBillInput } from "@/lib/supplier-bills/types";

export const SUPPLIER_BILL_LIMITS = {
  amountMax: 9999999999.99,
  billNumberMax: 60,
  notesMax: 2000,
} as const;

export type SupplierBillField =
  | "supplierId"
  | "subtotal"
  | "discount"
  | "billNumber"
  | "billDate"
  | "dueDate"
  | "notes";

export type SupplierBillFieldError =
  | "required"
  | "too_long"
  | "invalid_amount"
  | "not_a_number"
  | "more_than_subtotal"
  | "equals_subtotal"
  | "invalid_date"
  | "before_bill_date"
  | "supplier_invalid";

export type SupplierBillFieldErrors = Partial<
  Record<SupplierBillField, SupplierBillFieldError>
>;

export type SupplierBillValidationResult =
  | { ok: true; value: SupplierBillInput }
  | { ok: false; fieldErrors: SupplierBillFieldErrors };

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Validates a full create/update payload for a supplier bill. */
export function validateSupplierBillInput(
  input: unknown,
): SupplierBillValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, fieldErrors: { supplierId: "required" } };
  }

  const raw = input as Record<string, unknown>;
  const fieldErrors: SupplierBillFieldErrors = {};

  const supplierId = asTrimmedString(raw.supplierId);
  if (!UUID_PATTERN.test(supplierId)) {
    fieldErrors.supplierId = "supplier_invalid";
  }

  const subtotal = asFiniteNumber(raw.subtotal);
  if (subtotal === null) {
    fieldErrors.subtotal = "not_a_number";
  } else if (subtotal < 0 || subtotal > SUPPLIER_BILL_LIMITS.amountMax) {
    fieldErrors.subtotal = "invalid_amount";
  }

  const discount = asFiniteNumber(raw.discount);
  if (discount === null) {
    fieldErrors.discount = "not_a_number";
  } else if (discount < 0 || discount > SUPPLIER_BILL_LIMITS.amountMax) {
    fieldErrors.discount = "invalid_amount";
  } else if (subtotal !== null && discount > subtotal) {
    fieldErrors.discount = "more_than_subtotal";
  } else if (
    subtotal !== null &&
    subtotal > 0 &&
    discount === subtotal
  ) {
    fieldErrors.discount = "equals_subtotal";
  }

  const billNumber = optionalText(raw.billNumber, SUPPLIER_BILL_LIMITS.billNumberMax);
  if (billNumber === "too_long") fieldErrors.billNumber = "too_long";

  let billDate: string | null = null;
  const billDateRaw = optionalText(raw.billDate ?? "", 10);
  if (billDateRaw !== null && DATE_ONLY_PATTERN.test(billDateRaw)) {
    billDate = billDateRaw;
  } else if (billDateRaw !== null) {
    fieldErrors.billDate = "invalid_date";
  }

  let dueDate: string | null = null;
  const dueDateRaw = optionalText(raw.dueDate ?? "", 10);
  if (dueDateRaw === "too_long") {
    fieldErrors.dueDate = "invalid_date";
  } else if (dueDateRaw !== null && !DATE_ONLY_PATTERN.test(dueDateRaw)) {
    fieldErrors.dueDate = "invalid_date";
  } else if (dueDateRaw !== null) {
    dueDate = dueDateRaw;
  }

  if (dueDate !== null && billDate !== null && dueDate < billDate) {
    fieldErrors.dueDate = "before_bill_date";
  }

  const notes = optionalText(raw.notes, SUPPLIER_BILL_LIMITS.notesMax);
  if (notes === "too_long") fieldErrors.notes = "too_long";

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: {
      supplierId,
      subtotal: subtotal ?? 0,
      discount: discount ?? 0,
      billNumber: billNumber === "too_long" ? null : billNumber,
      billDate,
      dueDate,
      notes: notes === "too_long" ? null : notes,
    },
  };
}

/** Reuses the create validation for edits (all fields are always sent). */
export const validateSupplierBillUpdateInput = validateSupplierBillInput;