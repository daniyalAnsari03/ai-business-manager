import { serviceState } from "./service-state.mjs";

// Deterministic stand-in for lib/marketing/service.ts getMetaAdsConnection.
export async function getMetaAdsConnection() {
  return serviceState.metaAdsConnection;
}
