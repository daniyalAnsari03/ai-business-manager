/**
 * Boundary validation for product payloads. Pure functions only — safe to
 * use from the client form (instant feedback) and re-run inside the server
 * service (authoritative check). Errors are returned as stable codes so the
 * UI can localize them; no user-facing strings live here.
 */

import type { ProductInput } from "@/lib/products/types";

export const PRODUCT_LIMITS = {
  nameMin: 1,
  nameMax: 120,
  descriptionMax: 2000,
  categoryMin: 1,
  categoryMax: 60,
  skuMax: 60,
  /** Matches numeric(12,2) in Postgres. */
  priceMax: 99_999_999.99,
  stockMax: 9_999_999,
  thresholdMax: 999_999,
} as const;

export type ProductField =
  | "name"
  | "description"
  | "category"
  | "price"
  | "stockQuantity"
  | "lowStockThreshold"
  | "sku";

export type ProductFieldError =
  | "required"
  | "too_long"
  | "too_short"
  | "not_a_number"
  | "negative"
  | "too_large"
  | "not_an_integer";

export type ProductFieldErrors = Partial<Record<ProductField, ProductFieldError>>;

export type ProductValidationResult =
  | { ok: true; value: ProductInput }
  | { ok: false; fieldErrors: ProductFieldErrors };

type FieldCheck<T> = { ok: true; value: T } | { ok: false; error: ProductFieldError };

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown, max: number): FieldCheck<string | null> {
  if (value === null || value === undefined || typeof value !== "string") {
    return { ok: true, value: null };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  return trimmed.length > max
    ? { ok: false, error: "too_long" }
    : { ok: true, value: trimmed };
}

function parseNumeric(value: unknown): number | "not_a_number" {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : "not_a_number";
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return "not_a_number";
  }
  // Accept both "1,500" and "1500.50" style input.
  const parsed = Number(value.trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : "not_a_number";
}

/** Money: finite, non-negative, within numeric(12,2) bounds. */
function checkPrice(value: unknown): FieldCheck<number> {
  const parsed = parseNumeric(value);
  if (parsed === "not_a_number") return { ok: false, error: "not_a_number" };
  if (parsed < 0) return { ok: false, error: "negative" };
  if (parsed > PRODUCT_LIMITS.priceMax) return { ok: false, error: "too_large" };
  return { ok: true, value: Math.round(parsed * 100) / 100 };
}

/** Counts (stock/threshold): whole numbers, non-negative, bounded. */
function checkCount(value: unknown, max: number): FieldCheck<number> {
  const parsed = parseNumeric(value);
  if (parsed === "not_a_number" || !Number.isInteger(parsed)) {
    return { ok: false, error: "not_an_integer" };
  }
  if (parsed < 0) return { ok: false, error: "negative" };
  if (parsed > max) return { ok: false, error: "too_large" };
  return { ok: true, value: parsed };
}

/** Validates that imageUrl is a well-formed HTTP(S) URL, or null if empty. */
function validateImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

/** Validates a full create/update payload. */
export function validateProductInput(input: unknown): ProductValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, fieldErrors: { name: "required" } };
  }

  const raw = input as Record<string, unknown>;
  const fieldErrors: ProductFieldErrors = {};

  // Text fields
  const name = asTrimmedString(raw.name);
  if (name.length < PRODUCT_LIMITS.nameMin) fieldErrors.name = "required";
  else if (name.length > PRODUCT_LIMITS.nameMax) fieldErrors.name = "too_long";

  const category = asTrimmedString(raw.category);
  if (category.length < PRODUCT_LIMITS.categoryMin) fieldErrors.category = "required";
  else if (category.length > PRODUCT_LIMITS.categoryMax) fieldErrors.category = "too_long";

  const description = optionalText(raw.description, PRODUCT_LIMITS.descriptionMax);
  if (!description.ok) fieldErrors.description = description.error;

  const sku = optionalText(raw.sku, PRODUCT_LIMITS.skuMax);
  if (!sku.ok) fieldErrors.sku = sku.error;

  // Numeric fields
  const price = checkPrice(raw.price);
  if (!price.ok) fieldErrors.price = price.error;

  const stockQuantity = checkCount(raw.stockQuantity ?? 0, PRODUCT_LIMITS.stockMax);
  if (!stockQuantity.ok) fieldErrors.stockQuantity = stockQuantity.error;

  const lowStockThreshold = checkCount(
    raw.lowStockThreshold ?? 0,
    PRODUCT_LIMITS.thresholdMax,
  );
  if (!lowStockThreshold.ok) fieldErrors.lowStockThreshold = lowStockThreshold.error;

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  // All checks passed — safe to unwrap the successful values.
  return {
    ok: true,
    value: {
      name,
      description: description.ok ? description.value : null,
      category,
      price: price.ok ? price.value : 0,
      stockQuantity: stockQuantity.ok ? stockQuantity.value : 0,
      lowStockThreshold: lowStockThreshold.ok ? lowStockThreshold.value : 0,
      sku: sku.ok ? sku.value : null,
      imageUrl: validateImageUrl(raw.imageUrl),
    },
  };
}

/** Validates a standalone manual stock update. */
export function validateStockValue(
  value: unknown,
): { ok: true; stockQuantity: number } | { ok: false; error: ProductFieldError } {
  const result = checkCount(value, PRODUCT_LIMITS.stockMax);
  return result.ok
    ? { ok: true, stockQuantity: result.value }
    : { ok: false, error: result.error };
}

/**
 * Validates a signed stock DELTA (inventory module): a whole number that may
 * be negative (removal) or positive (addition), bounded so the resulting
 * quantity can never overflow the database column.
 */
export function validateStockDelta(
  value: unknown,
): { ok: true; delta: number } | { ok: false; error: ProductFieldError } {
  const parsed = parseNumeric(value);
  if (parsed === "not_a_number" || !Number.isInteger(parsed)) {
    return { ok: false, error: "not_an_integer" };
  }
  if (parsed === 0) return { ok: false, error: "required" };
  if (Math.abs(parsed) > PRODUCT_LIMITS.stockMax) {
    return { ok: false, error: "too_large" };
  }
  return { ok: true, delta: parsed };
}
