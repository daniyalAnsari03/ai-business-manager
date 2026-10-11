import { serviceState } from "./service-state.mjs";

// Deterministic stand-in for the business service the audited profile tool
// uses. The saved profile is derived from the stored one plus the incoming
// values, exactly like the real service sanitises and persists them.
export async function getUserBusiness() {
  return serviceState.business;
}

export async function updateBusinessProfile(input) {
  if (serviceState.updateBusinessResult) return serviceState.updateBusinessResult;
  const business = serviceState.business;
  if (!business) return { ok: false, reason: "database_error" };
  const phone = input.phone === null ? null : String(input.phone).replace(/\D/g, "");
  return {
    ok: true,
    business: {
      ...business,
      name: input.name,
      businessType: input.businessType,
      currency: input.currency,
      language: input.language,
      phone,
      address: input.address,
      updatedAt: "2026-02-01T00:00:00.000Z",
    },
  };
}