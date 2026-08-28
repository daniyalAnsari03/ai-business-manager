import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import {
  BUSINESS_TYPES,
  isBusinessType,
  isCurrencyCode,
} from "@/lib/business/constants";
import { isLanguage } from "@/lib/business/types";
import { getUserBusiness, updateBusinessProfile } from "@/lib/business/service";
import { toolFail, toolOk } from "@/lib/ai/tools/shared";

/**
 * Business settings tools — controlled wrappers over the SAME business
 * service the Settings page uses. Ownership always comes from the
 * authenticated session; RLS stays the second enforcement layer.
 *
 * These tools exist so the agent can answer "mera business ka naam kya hai?"
 * from REAL current data and perform supported profile edits (name, type,
 * currency, language, phone, address) instead of denying that the capability
 * exists.
 */

const NAME_MIN = 2;
const NAME_MAX = 80;
const PHONE_MAX = 30;
const ADDRESS_MAX = 400;

/** Model-supplied partial change set (all fields optional). */
export interface BusinessProfileChanges {
  name?: string | null;
  businessType?: string | null;
  currency?: string | null;
  language?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface MergedBusinessProfile {
  name: string;
  businessType: string;
  currency: string;
  language: string;
  phone: string | null;
  address: string | null;
}

export type MergeProfileResult =
  | { ok: true; value: MergedBusinessProfile }
  | { ok: false; reason: "invalid_input" };

function cleanOptionalText(
  value: string,
  max: number,
): string | null | "invalid" {
  const trimmed = value.trim();
  // An explicit empty string clears the field (mirrors the Settings form).
  if (!trimmed) return null;
  if (trimmed.length > max) return "invalid";
  return trimmed;
}

/**
 * Merges a partial change set onto the stored profile with the same boundary
 * rules as the Settings form (lib/business/service.ts). Unspecified fields
 * keep their current value; ANY explicit but invalid change fails the whole
 * merge so nothing is half-updated. Pure and side-effect-free for offline
 * testing.
 */
export function mergeBusinessProfileUpdate(
  current: {
    name: string;
    businessType: string;
    currency: string;
    language: string;
    phone: string | null;
    address: string | null;
  },
  changes: BusinessProfileChanges,
): MergeProfileResult {
  const invalid = (): MergeProfileResult => ({ ok: false, reason: "invalid_input" });

  // Name cannot be emptied or oversized — an explicit invalid name fails.
  let name = current.name;
  if (typeof changes.name === "string") {
    name = changes.name.trim();
    if (name.length < NAME_MIN || name.length > NAME_MAX) return invalid();
  }

  let businessType = current.businessType;
  if (
    typeof changes.businessType === "string" &&
    !isBusinessType(changes.businessType)
  ) {
    return invalid();
  }
  if (typeof changes.businessType === "string") {
    businessType = changes.businessType;
  }

  let currency = current.currency;
  if (
    typeof changes.currency === "string" &&
    !isCurrencyCode(changes.currency)
  ) {
    return invalid();
  }
  if (typeof changes.currency === "string") {
    currency = changes.currency;
  }

  let language = current.language;
  if (typeof changes.language === "string" && !isLanguage(changes.language)) {
    return invalid();
  }
  if (typeof changes.language === "string") {
    language = changes.language;
  }

  // Phone/address: absent/null keeps the stored value; "" clears; oversized
  // fails the merge.
  let phone = current.phone;
  if (changes.phone !== undefined && changes.phone !== null) {
    if (typeof changes.phone !== "string") return invalid();
    const cleaned = cleanOptionalText(changes.phone, PHONE_MAX);
    if (cleaned === "invalid") return invalid();
    phone = cleaned;
  }

  let address = current.address;
  if (changes.address !== undefined && changes.address !== null) {
    if (typeof changes.address !== "string") return invalid();
    const cleaned = cleanOptionalText(changes.address, ADDRESS_MAX);
    if (cleaned === "invalid") return invalid();
    address = cleaned;
  }

  return { ok: true, value: { name, businessType, currency, language, phone, address } };
}

function profileSummary(business: {
  name: string;
  businessType: string;
  currency: string;
  language: string;
  phone: string | null;
  address: string | null;
}) {
  return {
    name: business.name,
    businessType: business.businessType,
    currency: business.currency,
    language: business.language,
    phone: business.phone,
    address: business.address,
  };
}

export const getBusinessInfoTool = tool({
  name: "get_business_info",
  description:
    "Read the CURRENT business profile exactly as saved in Settings: name, business type, currency, language, phone and address. Use for 'mera business ka naam kya hai?' or any question about the business's own details. Always fetch fresh data instead of trusting memory.",
  parameters: z.object({}),
  execute: async () => {
    const business = await getUserBusiness();
    if (!business) {
      return toolFail("database_error", "Could not read the business profile.");
    }
    return toolOk({
      business: profileSummary(business),
      editable_fields: [
        "name",
        "businessType",
        "currency",
        "language",
        "phone",
        "address",
      ],
      hint: "These fields mirror the app's Settings page and can be updated through update_business_profile.",
    });
  },
});

export const updateBusinessProfileTool = tool({
  name: "update_business_profile",
  description:
    "Update the business profile (same fields as the Settings page): name, businessType (clothing_fashion/restaurant_food/retail_shop/grocery/electronics/services/other), currency (PKR/USD/EUR/GBP/AED/SAR/INR/BDT/TRY/MYR/CAD/AUD), language (en/ur), phone or address. Only include the fields that should change; everything else stays as it is. Report the saved values afterwards.",
  parameters: z.object({
    name: z.string().trim().min(2).max(80).optional().nullable(),
    businessType: z.enum(BUSINESS_TYPES).optional().nullable(),
    currency: z.string().trim().min(3).max(3).optional().nullable(),
    language: z.enum(["en", "ur"]).optional().nullable(),
    phone: z.string().trim().max(30).optional().nullable(),
    address: z.string().trim().max(400).optional().nullable(),
  }),
  execute: async (changes) => {
    const current = await getUserBusiness();
    if (!current) {
      return toolFail("database_error", "Could not read the business profile.");
    }

    const merged = mergeBusinessProfileUpdate(current, changes);
    if (!merged.ok) {
      return toolFail(
        "invalid_input",
        "Invalid business details. Correct them and retry without claiming success.",
      );
    }

    const result = await updateBusinessProfile(merged.value);
    if (!result.ok || !result.business) {
      return toolFail(
        result.reason ?? "database_error",
        "The business profile could not be saved. Do not claim success.",
      );
    }
    return toolOk({
      updated: true,
      name: result.business.name,
      business: profileSummary(result.business),
    });
  },
});
