import { serviceState } from "./service-state.mjs";

/**
 * Stand-in for the marketing social-post module. create_product fires a
 * best-effort "draft social post" side hook after the product is saved; that
 * hook is not what this suite verifies, and it must never call a model provider
 * or the database during an offline audit test. The real call site already
 * swallows any failure, so a no-op here changes no audited behaviour.
 */
export async function createDraftForProduct(product) {
  serviceState.marketingDrafts.push({ productId: product.id });
  return { ok: true, data: { id: "draft-stub" } };
}