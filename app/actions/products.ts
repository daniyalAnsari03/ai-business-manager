"use server";

import {
  createProduct,
  deleteProduct,
  getProduct,
  getProducts,
  updateProduct,
  updateStock,
  type ProductServiceError,
} from "@/lib/products/service";
import type { Product } from "@/lib/products/types";

export type ProductActionState =
  | { ok: true; product: Product }
  | { ok: false; reason: ProductServiceError };

export type ProductListActionState =
  | { ok: true; products: Product[] }
  | { ok: false; reason: ProductServiceError };

export type ProductDeleteActionState =
  | { ok: true; id: string }
  | { ok: false; reason: ProductServiceError };

/**
 * Thin server-action boundary over the product service. Inputs stay
 * `unknown` on purpose — validation and ownership happen inside the service,
 * never in the browser.
 */

export async function createProductAction(
  input: unknown,
): Promise<ProductActionState> {
  const result = await createProduct(input);
  return result.ok
    ? { ok: true, product: result.data }
    : { ok: false, reason: result.reason };
}

export async function updateProductAction(
  productId: string,
  input: unknown,
): Promise<ProductActionState> {
  const result = await updateProduct(productId, input);
  return result.ok
    ? { ok: true, product: result.data }
    : { ok: false, reason: result.reason };
}

export async function updateStockAction(
  productId: string,
  stockValue: unknown,
): Promise<ProductActionState> {
  const result = await updateStock(productId, stockValue);
  return result.ok
    ? { ok: true, product: result.data }
    : { ok: false, reason: result.reason };
}

export async function deleteProductAction(
  productId: string,
): Promise<ProductDeleteActionState> {
  const result = await deleteProduct(productId);
  return result.ok
    ? { ok: true, id: result.data.id }
    : { ok: false, reason: result.reason };
}

export async function getProductsAction(
  options: Parameters<typeof getProducts>[0] = {},
): Promise<ProductListActionState> {
  const result = await getProducts(options);
  return result.ok
    ? { ok: true, products: result.data }
    : { ok: false, reason: result.reason };
}

export async function getProductAction(
  productId: string,
): Promise<ProductActionState> {
  const result = await getProduct(productId);
  return result.ok
    ? { ok: true, product: result.data }
    : { ok: false, reason: result.reason };
}
