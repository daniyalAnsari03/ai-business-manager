/**
 * Boundary validation for product payloads. Pure functions only — safe to
 * use from the client form (instant feedback) and re-run inside the server
 * service (authoritative check). Errors are returned as stable codes so the
 * UI can localize them; no user-facing strings live here.
 */

import {
  CLOTHING_ATTRIBUTE_KEYS,
  normalizeProductAttributes,
  type ProductAttributes,
} from "@/lib/business/product-attributes";
import { normalizeUnit } from "@/lib/business/product-units";
import { hasCapability } from "@/lib/business/type-config";
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
  /** cost_price is numeric(12,2) too — same bounds as price. */
  costPriceMax: 99_999_999.99,
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
function checkMoney(value: unknown, max: number): FieldCheck<number> {
  const parsed = parseNumeric(value);
  if (parsed === "not_a_number") return { ok: false, error: "not_a_number" };
  if (parsed < 0) return { ok: false, error: "negative" };
  if (parsed > max) return { ok: false, error: "too_large" };
  // Money is stored with two decimals, so the stored value is the rounded one.
  return { ok: true, value: Math.round(parsed * 100) / 100 };
}

/** Selling price: money that must have been supplied. */
function checkPrice(value: unknown): FieldCheck<number> {
  return checkMoney(value, PRODUCT_LIMITS.priceMax);
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
 * Validates the OPTIONAL cost price a form field holds.
 *
 * A blank field is not an error and not a zero: it is the honest "the owner has
 * not told us a cost price" answer and resolves to null. It does NOT mean
 * "erase the stored cost" — erasing a recorded cost is the caller's own
 * explicit instruction through the `clearCostPrice` flag (docs/p5.txt), and the
 * create/update service leaves an omitted value untouched on purpose.
 *
 * Anything else goes through the same money rules as a selling price: finite,
 * non-negative, at most two decimals, within numeric(12,2) bounds.
 */
export function validateOptionalCostPrice(
  value: unknown,
): { ok: true; value: number | null } | { ok: false; error: ProductFieldError } {
  if (typeof value === "string" && value.trim().length === 0) {
    return { ok: true, value: null };
  }
  const result = checkMoney(value, PRODUCT_LIMITS.costPriceMax);
  return result.ok
    ? { ok: true, value: result.value }
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

/* ---------------------------------------------------------------------------
 * Business-type-specific extras: attributes, unit label, cost price
 * (docs/p1.txt — File 3 / Phase 2)
 *
 * These are validated separately from {@link validateProductInput} for one
 * reason: attributes depend on the BUSINESS TYPE, and the business type is only
 * known server-side (the service layer reads it from the owned business
 * record). It is never taken from client or model input, so the same payload can
 * be valid for a clothing shop and invalid for a grocery shop.
 *
 * Two rules carry through everything below, straight from the field validators:
 *   1. Never invent a value. An omitted key means "leave the stored value
 *      alone", never "reset it to a default"; only the three honest create
 *      defaults ({}, "Piece", null) are applied, and only when creating.
 *   2. Never silently drop. Anything the validator does not understand is a
 *      reported error the caller must see, not a value quietly discarded.
 * ------------------------------------------------------------------------ */

export type ProductExtraField = "attributes" | "unit" | "costPrice";

/** A single reported problem, with a message safe to show to the owner. */
export interface ProductExtraError {
  field: ProductExtraField;
  message: string;
}

/**
 * The validated extras of a create/update payload.
 *
 * `attributesPatch` holds ONLY what the caller supplied, already canonicalised,
 * so merging it onto the stored attributes can never add a key nobody asked for.
 */
export interface ProductWriteExtras {
  /** True when the caller supplied an attributes patch and/or a clear list. */
  attributesRequested: boolean;
  attributesPatch: ProductAttributes;
  /** Attribute keys the caller asked to remove. Never stored. */
  clearAttributes: string[];
  unitRequested: boolean;
  /** null when not requested (create then stores DEFAULT_UNIT). */
  unit: string | null;
  costPriceRequested: boolean;
  /** null means "not set" — never coerced to 0. */
  costPrice: number | null;
  /** True only when the caller EXPLICITLY asked to erase a recorded cost. */
  clearCostPrice: boolean;
}

export type ProductWriteExtrasResult =
  | { ok: true; value: ProductWriteExtras }
  | { ok: false; errors: ProductExtraError[] };

/** A key counts as "supplied" only when it is present and not undefined/null. */
function isSupplied(raw: Record<string, unknown>, key: string): boolean {
  return raw[key] !== undefined && raw[key] !== null;
}

const CLOTHING_ATTRIBUTE_KEY_SET: ReadonlySet<string> = new Set<string>(
  CLOTHING_ATTRIBUTE_KEYS,
);

/**
 * Validates the attribute keys an update wants to REMOVE. Unknown keys, a
 * non-list, or a key this business type has no vocabulary for are reported
 * errors — clearing is never a silent no-op, because "silently cleared
 * nothing" would leave the caller believing the attribute is gone.
 */
function validateClearAttributes(
  businessType: unknown,
  value: unknown,
): { ok: true; keys: string[] } | { ok: false; messages: string[] } {
  if (value === undefined || value === null) return { ok: true, keys: [] };
  if (!Array.isArray(value)) {
    return {
      ok: false,
      messages: ["Attributes to clear must be a list of attribute names."],
    };
  }

  const keys: string[] = [];
  const messages: string[] = [];
  for (const entry of value) {
    const key = typeof entry === "string" ? entry.trim() : "";
    if (!CLOTHING_ATTRIBUTE_KEY_SET.has(key)) {
      messages.push(
        `Unknown product attribute "${typeof entry === "string" ? entry : String(entry)}" cannot be cleared.`,
      );
      continue;
    }
    if (!keys.includes(key)) keys.push(key);
  }

  // A business type without the capability has no such vocabulary to clear, so
  // saying "cleared" would be a lie about a field that never had a meaning here.
  if (keys.length > 0 && !hasCapability(businessType, "fabric_attributes")) {
    for (const key of keys) {
      messages.push(
        `Product attribute "${key}" is not supported for this business type.`,
      );
    }
  }

  return messages.length > 0 ? { ok: false, messages } : { ok: true, keys };
}

/** Human-readable reason for a rejected cost price. */
function costPriceErrorMessage(error: ProductFieldError): string {
  switch (error) {
    case "negative":
      return "Cost price cannot be negative.";
    case "too_large":
      return "Cost price is too large.";
    default:
      return "Cost price must be a number.";
  }
}

/**
 * Validates the optional extras of a create/update payload against the
 * SERVER-SIDE business type.
 *
 * `raw` is the already-validated payload object (validateProductInput has
 * confirmed it is an object), so the extras are read from it in their
 * camelCase service form. Nothing here fills in a value the caller did not
 * supply: `unitRequested` / `costPriceRequested` / `attributesRequested` tell
 * the caller exactly which columns it may write, so an update that omits a key
 * leaves the stored value untouched instead of resetting it.
 */
export function validateProductWriteExtras(
  businessType: unknown,
  raw: Record<string, unknown>,
): ProductWriteExtrasResult {
  const errors: ProductExtraError[] = [];

  const attributesRequested =
    isSupplied(raw, "attributes") || isSupplied(raw, "clearAttributes");
  let attributesPatch: ProductAttributes = {};
  let clearAttributes: string[] = [];

  if (isSupplied(raw, "attributes")) {
    const result = normalizeProductAttributes(businessType, raw.attributes);
    if (result.ok) {
      attributesPatch = result.attributes;
    } else {
      for (const error of result.errors) {
        errors.push({ field: "attributes", message: error.message });
      }
    }
  }

  if (isSupplied(raw, "clearAttributes")) {
    const result = validateClearAttributes(businessType, raw.clearAttributes);
    if (result.ok) {
      clearAttributes = result.keys;
    } else {
      for (const message of result.messages) {
        errors.push({ field: "attributes", message });
      }
    }
  }

  const unitRequested = isSupplied(raw, "unit");
  let unit: string | null = null;
  if (unitRequested) {
    const result = normalizeUnit(raw.unit);
    if (result.ok) {
      unit = result.unit;
    } else {
      errors.push({ field: "unit", message: result.error.message });
    }
  }

  const costPriceRequested = isSupplied(raw, "costPrice");
  let costPrice: number | null = null;
  if (costPriceRequested) {
    const result = checkMoney(raw.costPrice, PRODUCT_LIMITS.costPriceMax);
    if (result.ok) {
      costPrice = result.value;
    } else {
      errors.push({ field: "costPrice", message: costPriceErrorMessage(result.error) });
    }
  }

  // Removing a recorded cost price is a separate, explicit instruction (docs/
  // p5.txt). Without it an omitted costPrice can only ever mean "leave it
  // alone", so a stored cost price could never be erased at all.
  let clearCostPrice = false;
  if (raw.clearCostPrice !== undefined && raw.clearCostPrice !== null) {
    if (typeof raw.clearCostPrice !== "boolean") {
      errors.push({
        field: "costPrice",
        message: "Removing the cost price must be asked for explicitly.",
      });
    } else {
      clearCostPrice = raw.clearCostPrice;
    }
  }
  // "Save this amount" and "delete the saved amount" in the same request is a
  // contradiction. Guessing which one was meant is how a business ends up with
  // a cost price nobody chose, so it is reported instead.
  if (clearCostPrice && costPriceRequested) {
    errors.push({
      field: "costPrice",
      message:
        "A new cost price and removing the current cost price cannot be sent together. Send one or the other.",
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      attributesRequested,
      attributesPatch,
      clearAttributes,
      unitRequested,
      unit,
      costPriceRequested,
      costPrice,
      clearCostPrice,
    },
  };
}

/**
 * Merges a validated attribute patch onto the STORED attributes.
 *
 * Only the keys the caller supplied change; every other stored key survives, so
 * an update that sets one attribute can never wipe the rest. Keys named in
 * `clearKeys` are removed, and a key named for removal AND supplied in the same
 * call is a caller mistake resolved the safe way: it is removed (the explicit
 * removal list wins) rather than silently written back.
 */
export function mergeProductAttributes(
  current: ProductAttributes,
  patch: ProductAttributes,
  clearKeys: readonly string[] = [],
): ProductAttributes {
  const merged: ProductAttributes = {};
  for (const [key, value] of Object.entries(current)) {
    if (clearKeys.includes(key)) continue;
    merged[key] = value;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (clearKeys.includes(key)) continue;
    merged[key] = value;
  }
  return merged;
}

/** Joins reported problems into one honest, user-safe sentence fragment. */
export function describeProductExtraErrors(
  errors: readonly ProductExtraError[],
): string {
  return errors.map((error) => error.message).join(" ");
}
