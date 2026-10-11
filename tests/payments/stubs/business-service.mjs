import { state } from "./state.mjs";

/** Stand-in for lib/business/service: the active tenant comes from state. */
export async function getUserBusiness() {
  return state.business ?? null;
}

/**
 * Only business-tools.ts imports this, and only to offer the AI a profile
 * edit. Tests never exercise it, so it returns the (possibly mutated) tenant.
 */
export async function updateBusinessProfile(patch = {}) {
  if (state.business) state.business = { ...state.business, ...patch };
  return state.business ?? null;
}