/**
 * Boundary validation for customer payloads. Pure functions only — safe to
 * use from the client form (instant feedback) and re-run inside the server
 * service (authoritative check). Errors are stable codes so the UI can
 * localize them; no user-facing strings live here.
 */

import type { CustomerInput } from "@/lib/customers/types";

export const CUSTOMER_LIMITS = {
  nameMin: 1,
  nameMax: 120,
  phoneMax: 30,
  emailMax: 200,
  addressMax: 500,
  notesMax: 2000,
} as const;

export type CustomerField =
  | "name"
  | "phone"
  | "email"
  | "address"
  | "notes";

export type CustomerFieldError =
  | "required"
  | "too_long"
  | "invalid_email";

export type CustomerFieldErrors = Partial<Record<CustomerField, CustomerFieldError>>;

export type CustomerValidationResult =
  | { ok: true; value: CustomerInput }
  | { ok: false; fieldErrors: CustomerFieldErrors };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

/** Validates a full create/update payload. */
export function validateCustomerInput(input: unknown): CustomerValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, fieldErrors: { name: "required" } };
  }

  const raw = input as Record<string, unknown>;
  const fieldErrors: CustomerFieldErrors = {};

  const name = asTrimmedString(raw.name);
  if (name.length < CUSTOMER_LIMITS.nameMin) fieldErrors.name = "required";
  else if (name.length > CUSTOMER_LIMITS.nameMax) fieldErrors.name = "too_long";

  const phone = optionalText(raw.phone, CUSTOMER_LIMITS.phoneMax);
  if (phone === "too_long") fieldErrors.phone = "too_long";

  const emailRaw = optionalText(raw.email, CUSTOMER_LIMITS.emailMax);
  let email: string | null = null;
  if (emailRaw === "too_long") {
    fieldErrors.email = "too_long";
  } else if (emailRaw !== null && !EMAIL_PATTERN.test(emailRaw)) {
    fieldErrors.email = "invalid_email";
  } else if (emailRaw !== null) {
    email = emailRaw.toLowerCase();
  }

  const address = optionalText(raw.address, CUSTOMER_LIMITS.addressMax);
  if (address === "too_long") fieldErrors.address = "too_long";

  const notes = optionalText(raw.notes, CUSTOMER_LIMITS.notesMax);
  if (notes === "too_long") fieldErrors.notes = "too_long";

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: {
      name,
      phone: phone === "too_long" ? null : phone,
      email,
      address: address === "too_long" ? null : address,
      notes: notes === "too_long" ? null : notes,
    },
  };
}
