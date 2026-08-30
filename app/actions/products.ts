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
import { createDraftForProduct } from "@/lib/marketing/social-posts";

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
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  // Marketing hook (Phase 2, reduced): once a product exists, trigger the
  // controlled service that generates a REAL AI caption and saves it as a
  // "draft" social post in the business's marketing activity. This is
  // best-effort — a caption-generation/provider failure must never block or
  // break product creation, so we await then swallow the outcome. The draft
  // is written through the same service the AI tool uses.
  try {
    await createDraftForProduct(result.data);
  } catch (error) {
    console.error(
      "[products-action] draft post generation failed after product creation:",
      error instanceof Error ? error.message : String(error),
    );
  }

  return { ok: true, product: result.data };
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
