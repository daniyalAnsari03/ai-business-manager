import { serviceState } from "./service-state.mjs";

// Deterministic stand-in for lib/products/service.ts getProducts.
export async function getProducts() {
  return serviceState.products;
}
