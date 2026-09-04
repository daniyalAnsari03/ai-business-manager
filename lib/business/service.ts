import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import {
  isBusinessType,
  isCurrencyCode,
} from "@/lib/business/constants";
import {
  isLanguage,
  type Business,
  type BusinessSetupInput,
  type Language,
} from "@/lib/business/types";
import { syncProfileLanguage } from "@/lib/profiles/service";
import { getServerUser, getSupabaseServerClient } from "@/lib/supabase/server";

interface BusinessRow {
  id: string;
  owner_id: string;
  name: string;
  business_type: string;
  currency: string;
  language: string;
  phone: string | null;
  address: string | null;
  setup_completed: boolean;
  created_at: string;
  updated_at: string;
}

function mapBusiness(row: BusinessRow): Business {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    businessType: isBusinessType(row.business_type)
      ? row.business_type
      : "other",
    currency: isCurrencyCode(row.currency) ? row.currency : "PKR",
    language: isLanguage(row.language) ? row.language : "en",
    phone: row.phone,
    address: row.address,
    setupCompleted: row.setup_completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The signed-in user's business. Ownership always comes from the server
 * session — a client-supplied business id is never trusted.
 *
 * `cache()` memoizes per request so the layout, the page and every module
 * service share one businesses query instead of each issuing its own.
 */
export const getUserBusiness = cache(async (): Promise<Business | null> => {
  const user = await getServerUser();
  if (!user) {
    console.log("[business-service] getUserBusiness: no authenticated user");
    return null;
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (error || !data) {
    console.log(
      "[business-service] getUserBusiness: no business found for user_id:",
      user.id,
      "error:",
      error?.message,
    );
    return null;
  }

  const business = mapBusiness(data as BusinessRow);
  console.log(
    "[business-service] getUserBusiness resolved business_id:",
    business.id,
    "name:",
    business.name,
    "for user_id:",
    user.id,
  );
  return business;
});

export interface ServiceResult<T> {
  ok: boolean;
  /** Safe, user-facing message (already localized by the caller's form). */
  reason?:
    | "unauthenticated"
    | "invalid_input"
    | "not_configured"
    | "database_error";
  business?: T;
}

const NAME_MIN = 2;
const NAME_MAX = 80;

/** Boundary validation for the setup form payload. */
function validateSetupInput(input: unknown): BusinessSetupInput | null {
  if (typeof input !== "object" || input === null) return null;
  const { name, businessType, currency, language } = input as Record<
    string,
    unknown
  >;

  if (typeof name !== "string") return null;
  const trimmedName = name.trim();
  if (trimmedName.length < NAME_MIN || trimmedName.length > NAME_MAX) return null;

  if (
    typeof businessType !== "string" ||
    !isBusinessType(businessType) ||
    typeof currency !== "string" ||
    !isCurrencyCode(currency) ||
    typeof language !== "string" ||
    !isLanguage(language)
  ) {
    return null;
  }

  return {
    name: trimmedName,
    businessType,
    currency,
    language,
  };
}

/**
 * Creates (or replaces) the caller's business profile and marks setup
 * complete. The owner is taken from the authenticated session; RLS is the
 * second enforcement layer.
 */
export async function completeBusinessSetup(
  input: unknown,
): Promise<ServiceResult<Business>> {
  let user;
  let supabase: SupabaseClient;
  try {
    user = await getServerUser();
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }

  if (!user) return { ok: false, reason: "unauthenticated" };

  const validInput = validateSetupInput(input);
  if (!validInput) return { ok: false, reason: "invalid_input" };

  const { data, error } = await supabase
    .from("businesses")
    .upsert(
      {
        owner_id: user.id,
        name: validInput.name,
        business_type: validInput.businessType,
        currency: validInput.currency,
        language: validInput.language,
        setup_completed: true,
      },
      { onConflict: "owner_id" },
    )
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, reason: "database_error" };
  }

  // Keep the account profile's language preference in sync with the
  // business choice made during setup. Best-effort — never blocks setup.
  await syncProfileLanguage(user.id, validInput.language);

  return { ok: true, business: mapBusiness(data as BusinessRow) };
}

/**
 * Mirrors a language change onto the signed-in owner's business row.
 * Ownership always comes from the server session; a missing business is
 * not an error (the caller's profile choice remains authoritative).
 */
export async function updateBusinessLanguage(
  language: Language,
): Promise<void> {
  const user = await getServerUser();
  if (!user) return;

  const supabase = await getSupabaseServerClient();
  await supabase.from("businesses").update({ language }).eq("owner_id", user.id);
}

const PHONE_MAX = 30;
const ADDRESS_MAX = 400;

/** Boundary validation for the settings form payload. */
function validateSettingsInput(
  input: unknown,
): BusinessSetupInput & { phone: string | null; address: string | null } | null {
  if (typeof input !== "object" || input === null) return null;
  const { name, businessType, currency, language, phone, address } =
    input as Record<string, unknown>;

  const base = validateSetupInput({ name, businessType, currency, language });
  if (!base) return null;

  const cleanPhone =
    typeof phone === "string" && phone.trim().length > 0
      ? phone.trim()
      : null;
  if (cleanPhone && cleanPhone.length > PHONE_MAX) return null;

  const cleanAddress =
    typeof address === "string" && address.trim().length > 0
      ? address.trim()
      : null;
  if (cleanAddress && cleanAddress.length > ADDRESS_MAX) return null;

  return { ...base, phone: cleanPhone, address: cleanAddress };
}

/**
 * Saves the Business Settings form. Ownership always comes from the
 * authenticated session; RLS is the second enforcement layer. The account
 * profile's language preference is kept in sync with the saved choice.
 */
export async function updateBusinessProfile(
  input: unknown,
): Promise<ServiceResult<Business>> {
  let user;
  let supabase: SupabaseClient;
  try {
    user = await getServerUser();
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }

  if (!user) return { ok: false, reason: "unauthenticated" };

  const validInput = validateSettingsInput(input);
  if (!validInput) return { ok: false, reason: "invalid_input" };

  const { data, error } = await supabase
    .from("businesses")
    .update({
      name: validInput.name,
      business_type: validInput.businessType,
      currency: validInput.currency,
      language: validInput.language,
      phone: validInput.phone,
      address: validInput.address,
    })
    .eq("owner_id", user.id)
    .select("*")
    .single();

  if (error || !data) return { ok: false, reason: "database_error" };

  // Keep the account profile's language in sync — best effort, never blocks.
  await syncProfileLanguage(user.id, validInput.language);

  return { ok: true, business: mapBusiness(data as BusinessRow) };
}
