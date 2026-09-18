import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { parseApprovalReply } from "@/lib/marketing/whatsapp/reply-parser";
import { matchesBusinessPhone } from "@/lib/marketing/whatsapp/phone";
import {
  configureApprovalExecutors,
  getApprovalExecutors,
} from "@/lib/marketing/approval-executors";
import {
  type ApprovalAction,
  type ApprovalActionType,
} from "@/lib/marketing/approval-types";
import {
  type WhatsappServiceResult,
} from "@/lib/marketing/whatsapp/approval-notify";
// The approval-request sender now lives in approval-notify.ts and is called
// directly by the approval engine when an action is parked as pending. It is
// re-exported here so existing importers keep working.
export { sendApprovalRequest } from "@/lib/marketing/whatsapp/approval-notify";

/**
 * WhatsApp approval reply service — processes inbound YES/NO replies.
 *
 * Inbound webhook processing uses the service-role client (no user session on
 * a webhook), derives business ownership from the action's stored business and
 * verifies the reply sender is the business owner by phone number before
 * acting. Everything is idempotent: the same provider message id is only ever
 * processed once.
 */

/** Ensure executors are wired once (idempotent). */
let executorsConfigured = false;
function ensureExecutors(): void {
  if (!executorsConfigured) {
    configureApprovalExecutors();
    executorsConfigured = true;
  }
}

interface BusinessRow {
  id: string;
  owner_id: string;
  phone: string | null;
  language: string;
  name: string;
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
  const businessId = (action["business_id"] as string) ?? "";

  const outcome = await runExecutorByType(claimToAction(action));

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

/**
 * Maps a claimed approval_actions row (service-role read) into the
 * ApprovalAction shape the executor registry expects. The id and business_id
 * come straight from the claimed row, which is the authoritative server state.
 */
function claimToAction(row: Record<string, unknown>): ApprovalAction {
  const payload = (row["action_payload"] as Record<string, unknown>) ?? {};
  const actionType = ((row["action_type"] as string) ?? "other") as ApprovalActionType;
  return {
    id: (row["id"] as string) ?? "",
    businessId: (row["business_id"] as string) ?? "",
    userId: (row["user_id"] as string) ?? null,
    actionType,
    actionPayload: payload,
    summary: (row["summary"] as string) ?? "",
    approvalMode: row["approval_mode"] === "full_auto" ? "full_auto" : "needs_approval",
    status: "executing",
    idempotencyKey: (row["idempotency_key"] as string) ?? null,
    createdAt: (row["created_at"] as string) ?? new Date().toISOString(),
    updatedAt: (row["updated_at"] as string) ?? new Date().toISOString(),
    expiresAt: null,
    approvedAt: null,
    rejectedAt: null,
    approvedBy: null,
    rejectedBy: null,
    executedAt: null,
    executionResult: null,
    executionError: null,
    externalReference: (row["external_reference"] as string) ?? null,
  };
}

async function runExecutorByType(action: ApprovalAction): Promise<{
  ok: boolean;
  result?: unknown;
  error?: string;
}> {
  const registry = getApprovalExecutors();
  const executor = registry[action.actionType];
  if (!executor) {
    return { ok: false, error: "No executor for this action type." };
  }
  try {
    return await executor(action);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Execution failed",
    };
  }
}