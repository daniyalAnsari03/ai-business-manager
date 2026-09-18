import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { getWhatsAppProvider } from "@/lib/marketing/whatsapp/provider";
import { toE164Digits } from "@/lib/marketing/whatsapp/phone";
import {
  buildApprovalMessage,
  generateApprovalReference,
} from "@/lib/marketing/whatsapp/message";

/**
 * WhatsApp approval-request sender.
 *
 * When an action is parked as `pending` the approval engine calls this to
 * PROACTIVELY notify the business owner on WhatsApp — the user does not have
 * to open the app to learn an approval is waiting. They can approve either
 * in-app (Marketing → Approvals) or by replying YES/NO on WhatsApp; both
 * paths execute through the same idempotent engine.
 *
 * Runs server-side with the service-role client because notification happens
 * from paths with no user session (server actions, webhooks, cron). Ownership
 * is still never trusted from input: the action's stored business row decides
 * who to notify. Honest: if no WhatsApp provider is configured it returns
 * `not_configured` and nothing is faked.
 */

export type WhatsappServiceError =
  | "not_configured"
  | "unauthorized"
  | "not_found"
  | "ambiguous"
  | "duplicate"
  | "invalid_input"
  | "database_error";

export type WhatsappServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: WhatsappServiceError; language?: "en" | "ur" };

interface BusinessRow {
  id: string;
  owner_id: string;
  phone: string | null;
  language: string;
  name: string;
}

/**
 * Sends the WhatsApp approval-request message for an action. The action must
 * belong to a business with a registered phone. Returns the reference so
 * callers can route future replies back to the exact action.
 */
export async function sendApprovalRequest(input: {
  actionId: string;
}): Promise<WhatsappServiceResult<{ reference: string; delivered: boolean }>> {
  const provider = getWhatsAppProvider();
  if (!provider) return { ok: false, reason: "not_configured" };

  const admin = await getSupabaseAdminClient();
  if (!admin) return { ok: false, reason: "not_configured" };

  // Load the action + its business.
  const { data: action, error: actionError } = await admin
    .from("approval_actions")
    .select("*")
    .eq("id", input.actionId)
    .single();
  if (actionError || !action) return { ok: false, reason: "not_found" };

  const { data: business, error: bizError } = await admin
    .from("businesses")
    .select("id, owner_id, phone, language, name")
    .eq("id", action.business_id)
    .single();
  if (bizError || !business) return { ok: false, reason: "not_found" };
  const biz = business as BusinessRow;

  if (!biz.phone) return { ok: false, reason: "invalid_input" };

  // Ensure the action has a stable external_reference so a YES/NO reply maps
  // to EXACTLY this action (never "the latest pending one").
  let reference = action.external_reference as string | null;
  if (!reference) {
    reference = generateApprovalReference();
    await admin
      .from("approval_actions")
      .update({ external_reference: reference })
      .eq("id", action.id);
  }

  const payload = action.action_payload as Record<string, unknown>;
  const text = buildApprovalMessage(
    {
      summary: action.summary as string,
      platform: typeof payload.platform === "string" ? payload.platform : null,
      productName:
        typeof payload.productName === "string" ? payload.productName : null,
      scheduledAt:
        typeof payload.scheduledAt === "string" ? payload.scheduledAt : null,
      language: biz.language === "ur" ? "ur" : "en",
    },
    reference,
  );

  // The WhatsApp provider requires E.164 digits (no "+", no trunk zero);
  // convert the stored phone so a locally-stored "03282241956" is sent as
  // "923282241956".
  const recipient = toE164Digits(biz.phone);

  const sent = await provider.sendText({
    businessId: biz.id,
    to: recipient,
    text,
    messageId: reference,
  });

  if (!sent.ok) {
    // Honest: the app attempted the send but the provider rejected it. The
    // action stays pending; the caller decides what to surface.
    console.warn(
      `[WhatsApp Approval] send failed action=${input.actionId} business=${biz.id} to=${recipient}: ${sent.reason}`,
    );
    return { ok: true, data: { reference, delivered: false } };
  }

  // Store provider message ID → business mapping for status webhook resolution.
  if (sent.data.providerMessageId) {
    try {
      await admin.from("whatsapp_message_id_map").insert({
        business_id: biz.id,
        provider_message_id: sent.data.providerMessageId,
        recipient_phone: recipient,
      });
    } catch {
      // Best-effort: mapping failure must not block the approval flow.
    }
  }

  return {
    ok: true,
    data: { reference, delivered: sent.data.delivered },
  };
}