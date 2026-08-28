import type { Language } from "@/lib/business/types";
import type { BusinessType } from "@/lib/business/constants";

/**
 * Per-request execution context handed to every agent tool. Everything in
 * here is derived SERVER-SIDE from the authenticated session — never from
 * client or model input.
 */
export interface AgentRunContext {
  businessId: string;
  businessName: string;
  businessType: BusinessType;
  currencyCode: string;
  currencySymbol: string;
  /** UI language selected by the user; drives the response language rule. */
  language: Language;
  /** Attached image URL for the current turn (if any). Tools can use this to
   *  auto-fill imageUrl when the model omits it. */
  imageUrl?: string;
}
