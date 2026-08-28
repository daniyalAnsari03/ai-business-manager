"use server";

import {
  adjustProductStock,
  updateStock,
  type ProductServiceError,
} from "@/lib/products/service";
import type { Product } from "@/lib/products/types";

/** Reasons the stock UI knows how to present. */
export type StockActionError = Exclude<ProductServiceError, "sku_conflict">;

export type StockActionState =
  | { ok: true; product: Product }
  | { ok: false; reason: StockActionError };

/**
 * Server actions for stock management. `updateStockAction` sets an absolute
 * value (existing Products flow); `adjustProductStockAction` applies a
 * signed delta (Inventory module) atomically on the server.
 */

export async function updateStockAction(
  productId: string,
  stockValue: unknown,
): Promise<StockActionState> {
  const result = await updateStock(productId, stockValue);
  return result.ok
    ? { ok: true, product: result.data }
    : { ok: false, reason: mapStockError(result.reason) };
}

export async function adjustProductStockAction(
  productId: string,
  delta: unknown,
): Promise<StockActionState> {
  const result = await adjustProductStock(productId, delta);
  return result.ok
    ? { ok: true, product: result.data }
    : { ok: false, reason: mapStockError(result.reason) };
}

/** SKU conflicts can't occur for stock-only operations. */
function mapStockError(reason: ProductServiceError): StockActionError {
  return reason === "sku_conflict" ? "invalid_input" : reason;
}
