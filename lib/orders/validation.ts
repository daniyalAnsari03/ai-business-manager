/**
 * Boundary validation for order payloads. Pure functions only — the client
 * form uses them for instant feedback and the server service re-runs them
 * as the authoritative check. Errors are stable codes for localization.
 */

import {
  isOrderStatus,
  type OrderInput,
  type OrderStatus,
} from "@/lib/orders/types";

export const ORDER_LIMITS = {
  notesMax: 2000,
  maxItems: 50,
  quantityMax: 100000,
} as const;

export type OrderField = "customer" | "discount" | "notes" | "orderedAt" | "items" | "status";

export type OrderFieldError =
  | "required"
  | "too_long"
  | "not_a_number"
  | "negative"
  | "too_large"
  | "not_an_integer"
  | "empty"
  | "invalid_product"
  | "duplicate_product";

export type OrderFieldErrors = Partial<Record<OrderField, OrderFieldError>>;

export type OrderValidationResult =
  | { ok: true; value: OrderInput }
  | { ok: false; fieldErrors: OrderFieldErrors };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value.trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Validates a create-order payload. Prices never come from the client —
 * only product references and quantities; the database function prices the
 * order authoritatively from the live products table.
 */
export function validateOrderInput(input: unknown): OrderValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, fieldErrors: { items: "empty" } };
  }

  const raw = input as Record<string, unknown>;
  const fieldErrors: OrderFieldErrors = {};

  // Customer is optional (walk-in sales have no saved customer).
  let customerId: string | null = null;
  if (
    typeof raw.customerId === "string" &&
    raw.customerId.trim().length > 0
  ) {
    if (!UUID_PATTERN.test(raw.customerId.trim())) {
      fieldErrors.customer = "invalid_product";
    } else {
      customerId = raw.customerId.trim();
    }
  }

  // Discount defaults to 0 and may not exceed the (unknown yet) subtotal
  // here — the database enforces discount <= subtotal authoritatively.
  let discount = 0;
  if (raw.discount !== undefined && raw.discount !== null && raw.discount !== "") {
    const parsed = parseNumeric(raw.discount);
    if (parsed === null) fieldErrors.discount = "not_a_number";
    else if (parsed < 0) fieldErrors.discount = "negative";
    else discount = Math.round(parsed * 100) / 100;
  }

  let notes: string | null = null;
  if (typeof raw.notes === "string" && raw.notes.trim().length > 0) {
    notes = raw.notes.trim();
    if (notes.length > ORDER_LIMITS.notesMax) fieldErrors.notes = "too_long";
  }

  // Optional creation status: "pending" (default) or "completed" (records a
  // sale and deducts stock atomically at creation). Anything else is invalid.
  let status: "pending" | "completed" = "pending";
  if (typeof raw.status === "string" && raw.status.trim().length > 0) {
    if (raw.status === "pending" || raw.status === "completed") {
      status = raw.status;
    } else {
      fieldErrors.status = "required";
    }
  }

  // Optional custom order date; must be a real date when provided.
  let orderedAt: string | null = null;
  if (typeof raw.orderedAt === "string" && raw.orderedAt.trim().length > 0) {
    const parsedDate = new Date(raw.orderedAt);
    if (Number.isNaN(parsedDate.getTime())) {
      fieldErrors.orderedAt = "required";
    } else {
      orderedAt = parsedDate.toISOString();
    }
  }

  // Items: at least one line, valid product ids, whole positive quantities.
  const items: Array<{ productId: string; quantity: number }> = [];
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    fieldErrors.items = "empty";
  } else if (raw.items.length > ORDER_LIMITS.maxItems) {
    fieldErrors.items = "too_large";
  } else {
    const seenProducts = new Set<string>();
    for (const entry of raw.items) {
      const item = entry as Record<string, unknown>;
      const productId =
        typeof item.productId === "string" ? item.productId.trim() : "";
      if (!UUID_PATTERN.test(productId)) {
        fieldErrors.items = "invalid_product";
        break;
      }
      if (seenProducts.has(productId)) {
        fieldErrors.items = "duplicate_product";
        break;
      }
      seenProducts.add(productId);

      const quantity = parseNumeric(item.quantity);
      if (
        quantity === null ||
        !Number.isInteger(quantity) ||
        quantity <= 0 ||
        quantity > ORDER_LIMITS.quantityMax
      ) {
        fieldErrors.items = "not_an_integer";
        break;
      }
      items.push({ productId, quantity });
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: { customerId, discount, notes, orderedAt, status, items },
  };
}

/** Validates a status transition request. */
export function validateOrderStatus(
  value: unknown,
): { ok: true; status: OrderStatus } | { ok: false } {
  if (typeof value !== "string" || !isOrderStatus(value)) return { ok: false };
  return { ok: true, status: value };
}
