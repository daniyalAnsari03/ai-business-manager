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
  /** Authenticated user id from the server session. Lets an audit row name the
   *  human the AI acted for, without ever trusting model input. */
  userId?: string;
  /** Trace id for this one chat request, shared by every tool call it makes so
   *  all audit rows produced by the turn can be found together. */
  correlationId?: string;
}
