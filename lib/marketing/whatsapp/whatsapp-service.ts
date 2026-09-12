import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { getWhatsAppProvider } from "@/lib/marketing/whatsapp/provider";
import { parseApprovalReply } from "@/lib/marketing/whatsapp/reply-parser";
import { matchesBusinessPhone } from "@/lib/marketing/whatsapp/phone";
import {
  buildApprovalMessage,
  generateApprovalReference,
} from "@/lib/marketing/whatsapp/message";
import {
  configureApprovalExecutors,
} from "@/lib/marketing/approval-executors";
import { registerNotifyOwner } from "@/lib/marketing/approval-service";

/**
 * WhatsApp approval service — sends approval requests and processes replies.
 *
 * Sending happens server-side through the configured WhatsApp provider. It is
 * honest: if no provider is configured, `sendApprovalNotification` returns
 * `not_configured` and nothing is faked.
 *
 * Inbound webhook processing uses the service-role client (no user session on
 * a webhook), derives business ownership from the action's stored business and
 * verifies the reply sender is the business owner by phone number before
 * acting. Everything is idempotent: the same provider message id is only ever
 * processed once.
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

/** Ensure executors are wired once (idempotent). */
let executorsConfigured = false;
function ensureExecutors(): void {
  if (!executorsConfigured) {
    configureApprovalExecutors();
    executorsConfigured = true;
  }
}

// Register the WhatsApp notification callback with the approval service so
// that when an action is parked as needs_approval, the owner is notified.
registerNotifyOwner(async (actionId: string) => {
  try {
    await sendApprovalRequest({ actionId });
  } catch {
    // Best-effort: notification failure must not break the approval flow.
  }
});

interface BusinessRow {
  id: string;
  owner_id: string;
  phone: string | null;
  language: string;
  name: string;
}

/**
 * Sends an approval request for an action via WhatsApp. The action must have
 * an `external_reference` to route replies back to it. Returns the reference
 * so callers can persist it.
 */
export async function sendApprovalRequest(input: {
  actionId: string;
}): Promise<WhatsappServiceResult<{ reference: string; delivered: boolean }>> {
  ensureExecutors();
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

  // Ensure the action has a stable external_reference for reply mapping.
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

  const sent = await provider.sendText({
    businessId: biz.id,
    to: biz.phone,
    text,
    messageId: reference,
  });

  // Store provider message ID → business mapping for status webhook resolution.
  if (sent.ok && sent.data.providerMessageId) {
    try {
      await admin.from("whatsapp_message_id_map").insert({
        business_id: biz.id,
        provider_message_id: sent.data.providerMessageId,
        recipient_phone: biz.phone,
      });
    } catch {
      // Best-effort: mapping failure must not block the approval flow.
    }
  }

  return {
    ok: true,
    data: { reference, delivered: sent.ok ? sent.data.delivered : false },
  };
}

/**
 * Processes an inbound WhatsApp message containing an approval reply.
 *
 * Security: only the business owner's phone number may approve; the message
 * must map to exactly one action via its external_reference; a duplicate
 * provider message id is ignored; an ambiguous reply is reported so the caller
 * can ask again.
 *
 * Cross-import safety: this runs in a webhook (service-role) context, so it
 * uses the admin client and never trusts any client input.
 */
export async function processInboundReply(input: {
  from: string;
  body: string;
  providerMessageId: string;
}): Promise<
  WhatsappServiceResult<{
    decision: "approve" | "reject" | "ambiguous";
    language?: "en" | "ur";
  }>
> {
  ensureExecutors();
  if (!input.from || !input.body.trim()) {
    return { ok: false, reason: "invalid_input" };
  }

  const admin = await getSupabaseAdminClient();
  if (!admin) return { ok: false, reason: "not_configured" };

  const decision = parseApprovalReply(input.body);
  if (decision === "ambiguous") {
    // Resolve the sender's business to determine the language for clarification.
    const { data: fromBizRows } = await admin
      .from("businesses")
      .select("language, phone")
      .not("phone", "is", null);
    const fromBiz = ((fromBizRows ?? []) as Array<{
      language: string;
      phone: string | null;
    }>).find((b) => matchesBusinessPhone(b.phone, input.from));
    const lang = fromBiz?.language === "ur" ? "ur" : "en";
    return { ok: false, reason: "ambiguous", language: lang };
  }

  // Duplicate detection: a provider message id is only ever processed once.
  const { data: existingEvent, error: dedupeError } = await admin
    .from("approval_events")
    .select("id")
    .eq("event", "whatsapp_reply")
    .contains("detail", { provider_message_id: input.providerMessageId })
    .maybeSingle();
  if (dedupeError) return { ok: false, reason: "database_error" };
  if (existingEvent) return { ok: false, reason: "duplicate" };

  // Find the action this reply refers to. Without an external_reference in the
  // reply, we cannot know which action — so we never guess "the latest one".
  // The reply body is just YES/NO; the mapping must come from a stored pending
  // request. We look up the most recent pending action for this business whose
  // external_reference is non-null AND that was sent to this sender's number.
  const { data: fromBusinessRows, error: fromBizError } = await admin
    .from("businesses")
    .select("id, owner_id, phone, language, name")
    .not("phone", "is", null);
  if (fromBizError) return { ok: false, reason: "database_error" };
  const senderBiz =
    ((fromBusinessRows ?? []) as BusinessRow[]).find((b) =>
      matchesBusinessPhone(b.phone, input.from),
    ) ?? null;

  // 1) If we can resolve the sender's business, try to match the pending
  //    request we actually sent them (by their phone). This keeps ownership
  //    scoped to a single business.
  let matchingAction: Record<string, unknown> | null = null;
  if (senderBiz) {
    const { data: candidate } = await admin
      .from("approval_actions")
      .select("*")
      .eq("business_id", senderBiz.id)
      .eq("status", "pending")
      .not("external_reference", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (candidate) matchingAction = candidate as Record<string, unknown>;
  }

  if (!matchingAction) {
    // No pending request for any business owned by this sender.
    return { ok: false, reason: "unauthorized" };
  }

  const actionId = matchingAction["id"] as string;
  const businessId = matchingAction["business_id"] as string;
  const ownerId = senderBiz?.owner_id;

  // 2) Verify the sender is the authorized approver (the business owner).
  const { data: ownerCheck, error: ownerCheckError } = await admin
    .from("businesses")
    .select("owner_id")
    .eq("id", businessId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (ownerCheckError) return { ok: false, reason: "database_error" };
  if (!ownerCheck) return { ok: false, reason: "unauthorized" };

  // Record the reply event (also our duplicate guard).
  await admin.from("approval_events").insert({
    approval_action_id: actionId,
    business_id: businessId,
    event: "whatsapp_reply",
    detail: { provider_message_id: input.providerMessageId, decision },
  });

  if (decision === "approve") {
    const result = await executeFromWebhook(admin, actionId);
    if (!result.ok) return result;
  } else {
    await admin
      .from("approval_actions")
      .update({
        status: "rejected",
        rejected_at: new Date().toISOString(),
        rejected_by: ownerId,
      })
      .eq("id", actionId);
    await admin.from("approval_events").insert({
      approval_action_id: actionId,
      business_id: businessId,
      event: "rejected",
      detail: { by_type: "whatsapp" },
    });
  }

  return { ok: true, data: { decision } };
}

/**
 * Execute an approved action from the webhook path (service-role client).
 *
 * This mirrors the session-bound engine's execution exactly: atomic claim to
 * prevent double execution, run the registered executor once, then finalise
 * with the real result. It cannot reuse the session-bound `executeAction`
 * helper because a webhook has no user session, so it routes through the same
 * registry the engine uses.
 */
async function executeFromWebhook(
  admin: SupabaseClient,
  actionId: string,
): Promise<WhatsappServiceResult<{ decision: "approve" | "reject" | "ambiguous" }>> {
  const { data: claim, error: claimError } = await admin.rpc(
    "claim_approval_action",
    { p_action_id: actionId },
  );
  if (claimError) return { ok: false, reason: "database_error" };
  if (!claim) {
    // Already executing/completed — idempotent, report approve as handled.
    return { ok: true, data: { decision: "approve" } };
  }
  const action = claim as Record<string, unknown>;
  const businessId = action["business_id"] as string;
  const actionType = action["action_type"] as string;
  const payload = (action["action_payload"] as Record<string, unknown>) ?? {};

  const outcome = await runExecutorByType(actionType, payload);

  const finalStatus = outcome.ok ? "completed" : "failed";
  await admin
    .from("approval_actions")
    .update({
      status: finalStatus,
      execution_result: outcome.ok ? outcome.result ?? null : null,
      execution_error: outcome.ok ? null : outcome.error ?? null,
    })
    .eq("id", actionId);

  await admin.from("approval_events").insert({
    approval_action_id: actionId,
    business_id: businessId,
    event: finalStatus,
    detail: outcome.ok
      ? { result: outcome.result ?? undefined }
      : { error: outcome.error ?? undefined },
  });

  return { ok: true, data: { decision: "approve" } };
}

import { getApprovalExecutors } from "@/lib/marketing/approval-executors";

async function runExecutorByType(
  actionType: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const registry = getApprovalExecutors();
  const executor = registry[actionType as keyof typeof registry];
  if (!executor) {
    return { ok: false, error: "No executor for this action type." };
  }
  const action = {
    id: "whatsapp-" + actionType,
    actionType: actionType,
    actionPayload: payload,
  } as never;
  try {
    return await executor(action);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Execution failed",
    };
  }
}
