import { serviceState } from "./service-state.mjs";
import { normalizeProductAttributes } from "../../../lib/business/product-attributes.ts";
import { normalizeUnit } from "../../../lib/business/product-units.ts";
import { hasCapability } from "../../../lib/business/type-config.ts";

function findProduct(productId) {
  return (serviceState.products.data ?? []).find((p) => p.id === productId) ?? null;
}

/**
 * This stub stands in for lib/products/service.ts, so it must reproduce the
 * REAL service's behaviour for the business-type-specific extras (attributes,
 * unit, cost price) — validation messages, the merge rule, the create defaults
 * and the "only write the column the caller asked for" rule. The pure
 * validators it relies on are the real ones, imported above, so the tool-level
 * checks exercise genuine normalisation rather than a hand-written imitation.
 */

/** The business type always comes from the stored business record. */
function businessType() {
  return serviceState.business?.businessType ?? "other";
}

function invalid(detail) {
  return { ok: false, reason: "invalid_input", detail };
}

/** Normalises an attributes patch for the CURRENT business type. */
function normalizeAttributesPatch(value) {
  const result = normalizeProductAttributes(businessType(), value ?? {});
  if (result.ok) return { ok: true, attributes: result.attributes };
  return invalid(result.errors.map((error) => error.message).join(" "));
}

/** Rejects attribute keys the business type has no vocabulary for. */
function normalizeClearAttributes(value) {
  const keys = [];
  for (const entry of value ?? []) {
    const key = typeof entry === "string" ? entry.trim() : "";
    if (!key) continue;
    if (!hasCapability(businessType(), "fabric_attributes")) {
      return invalid(`Product attribute "${key}" is not supported for this business type.`);
    }
    keys.push(key);
  }
  return { ok: true, keys };
}

/** Canonical unit label, or an honest error (never a silent default). */
function normalizeUnitOrFail(value) {
  const result = normalizeUnit(value);
  return result.ok ? { ok: true, unit: result.unit } : invalid(result.error.message);
}

/** Cost price: 0 or more, two decimals, null means "not set". */
function normalizeCostPriceOrFail(value) {
  if (value === null || value === undefined) return { ok: true, costPrice: null };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid("Cost price must be a number.");
  }
  if (value < 0) return invalid("Cost price cannot be negative.");
  return { ok: true, costPrice: Math.round(value * 100) / 100 };
}

// Deterministic stand-ins for the product service functions the audited tools
// call. Success results are derived from the fixture so the "after" stock value
// reflects the real operation (set / adjust).
export async function getProducts() {
  return serviceState.products;
}

export async function updateStock(productId, stockValue) {
  if (serviceState.updateStockResult) return serviceState.updateStockResult;
  const product = findProduct(productId);
  if (!product) return { ok: false, reason: "not_found" };
  return { ok: true, data: { ...product, stockQuantity: stockValue } };
}

export async function adjustProductStock(productId, delta) {
  if (serviceState.adjustStockResult) return serviceState.adjustStockResult;
  const product = findProduct(productId);
  if (!product) return { ok: false, reason: "not_found" };
  const next = product.stockQuantity + delta;
  if (next < 0) return { ok: false, reason: "insufficient_stock" };
  return { ok: true, data: { ...product, stockQuantity: next } };
}

export async function deleteProduct(productId) {
  if (serviceState.deleteProductResult) return serviceState.deleteProductResult;
  const product = findProduct(productId);
  if (!product) return { ok: false, reason: "not_found" };
  return { ok: true, data: { id: product.id } };
}

// Deterministic stand-ins for the audited create/update product paths. A
// success applies the incoming values onto the stored record, so the audit
// snapshot reflects exactly the fields that really changed.
export async function createProduct(input) {
  if (serviceState.createProductResult) return serviceState.createProductResult;

  const attributes = normalizeAttributesPatch(input.attributes);
  if (!attributes.ok) return attributes;
  const unit = normalizeUnitOrFail(input.unit ?? "Piece");
  if (!unit.ok) return unit;
  const costPrice = normalizeCostPriceOrFail(input.costPrice ?? null);
  if (!costPrice.ok) return costPrice;

  return {
    ok: true,
    data: {
      id: "product-new",
      businessId: "biz",
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      price: input.price,
      stockQuantity: input.stockQuantity ?? 0,
      lowStockThreshold: input.lowStockThreshold ?? 5,
      sku: input.sku ?? null,
      imageUrl: input.imageUrl ?? null,
      attributes: attributes.attributes,
      unit: unit.unit,
      costPrice: costPrice.costPrice,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

export async function updateProduct(productId, input) {
  if (serviceState.updateProductResult) return serviceState.updateProductResult;
  const product = findProduct(productId);
  if (!product) return { ok: false, reason: "not_found" };

  const next = { ...product };
  for (const field of [
    "name",
    "description",
    "category",
    "price",
    "stockQuantity",
    "lowStockThreshold",
    "sku",
    "imageUrl",
  ]) {
    if (input[field] !== undefined) next[field] = input[field];
  }

  // Each extra column is written only when the caller asked for it, so an update
  // about the price can never reset a stored unit or wipe recorded attributes.
  if (input.unit !== undefined && input.unit !== null) {
    const unit = normalizeUnitOrFail(input.unit);
    if (!unit.ok) return unit;
    next.unit = unit.unit;
  }
  // Erasing a recorded cost price is its own explicit instruction, and it can
  // never arrive together with a new value (docs/p5.txt).
  if (input.clearCostPrice === true) {
    if (input.costPrice !== undefined && input.costPrice !== null) {
      return invalid(
        "A new cost price and removing the current cost price cannot be sent together. Send one or the other.",
      );
    }
    next.costPrice = null;
  } else if (input.costPrice !== undefined && input.costPrice !== null) {
    const costPrice = normalizeCostPriceOrFail(input.costPrice);
    if (!costPrice.ok) return costPrice;
    next.costPrice = costPrice.costPrice;
  }
  if (input.attributes !== undefined || input.clearAttributes !== undefined) {
    const patch = normalizeAttributesPatch(input.attributes);
    if (!patch.ok) return patch;
    const clear = normalizeClearAttributes(input.clearAttributes);
    if (!clear.ok) return clear;
    // MERGE, never replace: only the supplied keys change, removal only for the
    // keys the caller named.
    const merged = {};
    for (const [key, value] of Object.entries(product.attributes ?? {})) {
      if (clear.keys.includes(key)) continue;
      merged[key] = value;
    }
    for (const [key, value] of Object.entries(patch.attributes)) {
      if (clear.keys.includes(key)) continue;
      merged[key] = value;
    }
    next.attributes = merged;
  }

  return { ok: true, data: next };
}
