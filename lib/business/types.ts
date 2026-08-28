import type { BusinessType, CurrencyCode } from "@/lib/business/constants";

/** Supported application languages. "ur" = Roman Urdu. */
export const LANGUAGES = ["en", "ur"] as const;
export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

export interface Business {
  id: string;
  ownerId: string;
  name: string;
  businessType: BusinessType;
  currency: CurrencyCode;
  language: Language;
  phone: string | null;
  address: string | null;
  setupCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessSetupInput {
  name: string;
  businessType: BusinessType;
  currency: CurrencyCode;
  language: Language;
}
