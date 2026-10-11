import { db, supabaseStub } from "./supabase-memory.mjs";

/**
 * Stand-in for @/lib/supabase/server. getServerUser / getSupabaseServerClient
 * return the in-memory session; getSupabaseAdminClient throws because the
 * product service must never reach for a service-role client.
 */
export async function getServerUser() {
  return { id: "stub-user", email: null, user_metadata: {} };
}

export async function getSupabaseServerClient() {
  return supabaseStub;
}

export async function getSupabaseAdminClient() {
  throw new Error("product-service test stub: the product service must not use the admin client");
}

/**
 * Stand-in for @/lib/business/service. The owned business is derived from the
 * session, exactly like the real service does — the business TYPE used to
 * validate product attributes comes from here and can never come from a payload.
 */
export async function getUserBusiness() {
  return {
    id: db.businessId,
    ownerId: "stub-user",
    name: "Test Shop",
    businessType: db.businessType,
    currency: "PKR",
    language: "en",
    phone: null,
    address: null,
    setupCompleted: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
