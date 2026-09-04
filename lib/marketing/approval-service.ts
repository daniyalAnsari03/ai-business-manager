import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import { getAutomationMode } from "@/lib/marketing/automation";
import {
  APPROVAL_ACTION_STATUSES,
  isActionEligibleForAuto,
  type ApprovalAction,
  type ApprovalActionStatus,
  type ApprovalActionType,
  type CreateApprovalActionInput,
  type ReviewableAction,
} from "@/lib/marketing/approval-types";

/**
 * The approval action engine — the ONLY place that talks to Supabase about
 * `approval_actions` / `approval_events`, and the ONLY entry point through
 * which an action is created, approved, rejected or executed.
 *
 * Core guarantees (per docs/phase4.txt):
 *   - A `pending` action is NEVER executed by the caller; execution only
 *     happens through this service which claims the row atomically.
 *   - An action is approved/executed at most once (idempotent).
 *   - Expired actions cannot execute.
 *   - Ownership always comes from the authenticated server-side session.
 *   - In full-auto mode, only SAFE action types auto-run; sensitive actions
 *     (money / ad spend / destructive) always require approval.
 *
 * `executor` functions are stored in a registry (lib/marketing/approval-executors.ts)
 * keyed by action type, so a caller creating an action cannot smuggle arbitrary
 * code into the database.
 */

export type ApprovalServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "not_found"
  | "not_pending"
  | "expired"
  | "duplicate"
  | "unauthorized"
  | "execution_failed"
  | "database_error";

export type ApprovalServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ApprovalServiceError };

/** Registry of real executors, populated by approval-executors.ts. */
import type { ApprovalExecutorRegistry } from "@/lib/marketing/approval-executors";

let executorRegistry: ApprovalExecutorRegistry | null = null;

export function registerExecutors(registry: ApprovalExecutorRegistry): void {
  executorRegistry = registry;
}

async function requireBusinessContext(): Promise<
  | { ok: true; supabase: SupabaseClient; business: Business }
  | { ok: false; reason: ApprovalServiceError }
> {
  let user;
  let supabase: SupabaseClient;
  try {
    user = await getServerUser();
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }
  if (!user) return { ok: false, reason: "unauthenticated" };

  const business = await getUserBusiness();
  if (!business) return { ok: false, reason: "no_business" };
  return { ok: true, supabase, business };
}

function isStatus(value: string): value is ApprovalActionStatus {
  return (APPROVAL_ACTION_STATUSES as readonly string[]).includes(value);
}

interface ApprovalActionRow {
  id: string;
  business_id: string;
  user_id: string | null;
  action_type: string;
  action_payload: unknown;
  summary: string;
  approval_mode: string;
  status: string;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  approved_by: string | null;
  rejected_by: string | null;
  executed_at: string | null;
  execution_result: unknown;
  execution_error: string | null;
  external_reference: string | null;
}

function mapAction(row: ApprovalActionRow): ApprovalAction {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    actionType: row.action_type as ApprovalActionType,
    actionPayload: (row.action_payload as Record<string, unknown>) ?? {},
    summary: row.summary,
    approvalMode:
      row.approval_mode === "full_auto" ? "full_auto" : "needs_approval",
    status: isStatus(row.status) ? row.status : "pending",
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    approvedBy: row.approved_by,
    rejectedBy: row.rejected_by,
    executedAt: row.executed_at,
    executionResult: (row.execution_result as Record<string, unknown>) ?? null,
    executionError: row.execution_error,
    externalReference: row.external_reference,
  };
}

/** Appends a transition to the audit log (best-effort, never throws). */
async function logEvent(
  supabase: SupabaseClient,
  actionId: string,
  businessId: string,
  event: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from("approval_events").insert({
      approval_action_id: actionId,
      business_id: businessId,
      event,
      detail: detail ?? null,
    });
  } catch {
    // Audit logging must never break the happy path.
  }
}

/**
 * Creates a pending approval action. This is the ONLY way an action is parked
 * for review. The idempotency key is unique per business, so calling this
 * twice for the same logical request returns the existing pending row instead
 * of creating a duplicate.
 */
export async function createApprovalAction(
  input: Omit<CreateApprovalActionInput, "executor"> & {
    executor?: never;
  },
): Promise<ApprovalServiceResult<ApprovalAction>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  if (!input.idempotencyKey.trim()) {
    return { ok: false, reason: "invalid_input" };
  }
  if (!input.summary.trim()) {
    return { ok: false, reason: "invalid_input" };
  }

  // Idempotency: if an action with this key already exists, return it rather
  // than creating a duplicate (unless it was finalised — then it is a true
  // duplicate request and we reject it).
  const { data: existing, error: existingError } = await context.supabase
    .from("approval_actions")
    .select("*")
    .eq("business_id", context.business.id)
    .eq("idempotency_key", input.idempotencyKey.trim())
    .maybeSingle();

  if (existingError) return { ok: false, reason: "database_error" };

  if (existing) {
    const mapped = mapAction(existing as ApprovalActionRow);
    if (mapped.status === "pending" || mapped.status === "approved") {
      return { ok: true, data: mapped };
    }
    return { ok: false, reason: "duplicate" };
  }

  const { data, error } = await context.supabase
    .from("approval_actions")
    .insert({
      business_id: context.business.id,
      user_id: context.business.ownerId,
      action_type: input.actionType,
      action_payload: input.payload,
      summary: input.summary,
      approval_mode: "needs_approval",
      status: "pending",
      idempotency_key: input.idempotencyKey.trim(),
    })
    .select("*")
    .single();

  if (error) return { ok: false, reason: "database_error" };

  const action = mapAction(data as ApprovalActionRow);
  await logEvent(context.supabase, action.id, context.business.id, "created", {
    action_type: action.actionType,
  });
  return { ok: true, data: action };
}

/**
 * Approves a pending action and executes it exactly once. This is the action
 * behind BOTH the in-app Approve button and the WhatsApp approval reply.
 *
 * Idempotency + safety: the row may only move from `pending` (or `approved`,
 * when a previous execution attempt crashed before recording the result) to
 * `executing` in a single atomic claim. After that, execution runs and the
 * row is finalised to completed/failed. A second approve call for the same
 * action sees a non-claimable row and returns without re-executing.
 */
export async function approveAction(
  actionId: string,
): Promise<ApprovalServiceResult<ApprovalAction>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  // Authorize: the caller's business must own this action.
  const { data: row, error: rowError } = await context.supabase
    .from("approval_actions")
    .select("*")
    .eq("id", actionId)
    .eq("business_id", context.business.id)
    .single();

  if (rowError || !row) return { ok: false, reason: "unauthorized" };

  const action = mapAction(row as ApprovalActionRow);

  if (action.status === "executing" || action.status === "completed") {
    return { ok: true, data: action };
  }
  if (action.status === "rejected" || action.status === "cancelled") {
    return { ok: false, reason: "not_pending" };
  }
  if (isExpired(action)) {
    return { ok: false, reason: "expired" };
  }

  return executeAction(context.supabase, context.business, action);
}

/**
 * Rejects a pending action. Locked states (executing/completed) cannot be
 * rejected; a rejected action can never execute.
 */
export async function rejectAction(
  actionId: string,
): Promise<ApprovalServiceResult<ApprovalAction>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data: row, error: rowError } = await context.supabase
    .from("approval_actions")
    .select("*")
    .eq("id", actionId)
    .eq("business_id", context.business.id)
    .single();

  if (rowError || !row) return { ok: false, reason: "unauthorized" };
  const action = mapAction(row as ApprovalActionRow);

  if (action.status === "completed" || action.status === "executing") {
    return { ok: false, reason: "not_pending" };
  }
  if (action.status === "rejected") {
    return { ok: true, data: action };
  }

  const { data, error } = await context.supabase
    .from("approval_actions")
    .update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      rejected_by: context.business.ownerId,
    })
    .eq("id", actionId)
    .eq("business_id", context.business.id)
    .select("*")
    .single();

  if (error || !data) return { ok: false, reason: "database_error" };

  const updated = mapAction(data as ApprovalActionRow);
  await logEvent(context.supabase, actionId, context.business.id, "rejected", {
    by_type: "in_app",
  });
  return { ok: true, data: updated };
}

/**
 * Decides whether an action can run automatically (full-auto mode) and, if
 * so, creates + executes it immediately. If the action needs approval, it is
 * parked as pending and returned for review.
 *
 * Returns `needs_approval` when the action was parked, and `executed` when it
 * ran — the caller never inspects the raw status to guess.
 */
export async function decideAndRunAction(
  input: CreateApprovalActionInput,
): Promise<
  ApprovalServiceResult<
    | { outcome: "needs_approval"; action: ApprovalAction }
    | { outcome: "executed"; action: ApprovalAction }
  >
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const modeResult = await getAutomationMode();
  if (!modeResult.ok) return { ok: false, reason: "database_error" };
  const mode = modeResult.data;

  const eligible = isActionEligibleForAuto(input.actionType);

  // Full-auto only auto-runs SAFE actions; sensitive ones need approval.
  if (mode === "full_auto" && eligible) {
    const created = await createDirectAction(context.supabase, context.business, input, "full_auto");
    if (!created.ok) return created;
    const executed = await executeAction(context.supabase, context.business, created.data);
    if (executed.ok) {
      return { ok: true, data: { outcome: "executed", action: executed.data } };
    }
    // Execution failed — surface the failure honestly.
    return { ok: false, reason: "execution_failed" };
  }

  // needs_approval (default) — park as pending.
  const parked = await createDirectAction(context.supabase, context.business, input, "needs_approval");
  if (!parked.ok) return parked;
  return { ok: true, data: { outcome: "needs_approval", action: parked.data } };
}

/** Creates a fresh action row (no idempotency check — internal). */
async function createDirectAction(
  supabase: SupabaseClient,
  business: Business,
  input: CreateApprovalActionInput,
  mode: "needs_approval" | "full_auto",
): Promise<ApprovalServiceResult<ApprovalAction>> {
  if (!input.idempotencyKey.trim() || !input.summary.trim()) {
    return { ok: false, reason: "invalid_input" };
  }
  const { data, error } = await supabase
    .from("approval_actions")
    .insert({
      business_id: business.id,
      user_id: business.ownerId,
      action_type: input.actionType,
      action_payload: input.payload,
      summary: input.summary,
      approval_mode: mode,
      status: "pending",
      idempotency_key: input.idempotencyKey.trim(),
    })
    .select("*")
    .single();

  if (error) return { ok: false, reason: "database_error" };
  const action = mapAction(data as ApprovalActionRow);
  await logEvent(supabase, action.id, business.id, "created", {
    action_type: action.actionType,
    mode,
  });
  return { ok: true, data: action };
}

function isExpired(action: ApprovalAction): boolean {
  return (
    !!action.expiresAt &&
    action.status === "pending" &&
    new Date(action.expiresAt).getTime() < Date.now()
  );
}

/**
 * Core execution path. Claims the action atomically (status => executing),
 * runs the registered executor exactly once, records the verified result, and
 * finalises the row. Both in-app approval and full-auto execution funnel here,
 * so there is exactly ONE way an action runs.
 */
async function executeAction(
  supabase: SupabaseClient,
  business: Business,
  action: ApprovalAction,
): Promise<ApprovalServiceResult<ApprovalAction>> {
  // Atomic claim — only allowed from `approved` (in-app approval) or `pending`
  // (full-auto eligibility). Returns the updated row or null if raced.
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_approval_action",
    { p_action_id: action.id },
  );

  if (claimError || !claimed) {
    // Raced by another execution; treat as already-complete/via-other-path.
    const { data: reRead, error: reReadError } = await supabase
      .from("approval_actions")
      .select("*")
      .eq("id", action.id)
      .eq("business_id", business.id)
      .single();
    if (reReadError || !reRead) return { ok: false, reason: "database_error" };
    return { ok: true, data: mapAction(reRead as ApprovalActionRow) };
  }

  const claimRow = mapAction(claimed as ApprovalActionRow);
  await logEvent(supabase, action.id, business.id, "executing");

  // Run the registered executor for this action type.
  const executor = executorRegistry?.[claimRow.actionType];
  if (!executor) {
    const failedResult = await finalizeExecution(
      supabase,
      action.id,
      business.id,
      "failed",
      null,
      "No executor is registered for this action type.",
    );
    return failedResult;
  }

  let executionResult: unknown = null;
  let executionError: string | null = null;
  try {
    const result = await executor(claimRow);
    if (result.ok) {
      executionResult = result.result ?? null;
    } else {
      executionError = result.error ?? "The action could not be completed.";
    }
  } catch (error) {
    executionError =
      error instanceof Error ? error.message : "The action could not be completed.";
  }

  const finalStatus: ApprovalActionStatus = executionError === null ? "completed" : "failed";
  const finalized = await finalizeExecution(
    supabase,
    action.id,
    business.id,
    finalStatus,
    executionResult,
    executionError,
  );
  if (!finalized.ok) return finalized;

  await logEvent(
    supabase,
    action.id,
    business.id,
    executionError === null ? "completed" : "failed",
    executionError === null
      ? { result: executionResult ?? undefined }
      : { error: executionError },
  );

  return { ok: true, data: finalized.data };
}

async function finalizeExecution(
  supabase: SupabaseClient,
  actionId: string,
  businessId: string,
  status: ApprovalActionStatus,
  result: unknown,
  error: string | null,
): Promise<ApprovalServiceResult<ApprovalAction>> {
  const { data, error: updateError } = await supabase
    .from("approval_actions")
    .update({
      status,
      execution_result: result ?? null,
      execution_error: error,
    })
    .eq("id", actionId)
    .eq("business_id", businessId)
    .select("*")
    .single();

  if (updateError || !data) return { ok: false, reason: "database_error" };
  return { ok: true, data: mapAction(data as ApprovalActionRow) };
}

/**
 * Reviews pending actions for the in-app Review screen. Expired rows are
 * surfaced with `hasExpired: true` so the UI can mark them, but they are
 * never executed.
 */
export async function listReviewableActions(): Promise<
  ApprovalServiceResult<ReviewableAction[]>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("approval_actions")
    .select("*")
    .eq("business_id", context.business.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) return { ok: false, reason: "database_error" };

  const now = Date.now();
  const items = ((data ?? []) as ApprovalActionRow[]).map((row) => {
    const action = mapAction(row);
    const expired = !!action.expiresAt && new Date(action.expiresAt).getTime() < now;
    return toReviewable(action, expired);
  });
  return { ok: true, data: items };
}

function toReviewable(action: ApprovalAction, hasExpired: boolean): ReviewableAction {
  const payload = action.actionPayload as Record<string, unknown>;
  return {
    id: action.id,
    actionType: action.actionType,
    summary: action.summary,
    payload: action.actionPayload,
    createdAt: action.createdAt,
    expiresAt: action.expiresAt,
    hasExpired,
    platform: typeof payload.platform === "string" ? payload.platform : null,
    productName: typeof payload.productName === "string" ? payload.productName : null,
    scheduledAt: typeof payload.scheduledAt === "string" ? payload.scheduledAt : null,
  };
}

/**
 * Full history (pending / approved / rejected / completed / failed / expired /
 * cancelled) so the user can see what happened to previous approvals. Never
 * fabricates data — only real rows are shown.
 */
export async function listApprovalHistory(
  limit = 50,
): Promise<ApprovalServiceResult<ApprovalAction[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("approval_actions")
    .select("*")
    .eq("business_id", context.business.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { ok: false, reason: "database_error" };
  return {
    ok: true,
    data: ((data ?? []) as ApprovalActionRow[]).map(mapAction),
  };
}

/**
 * Resolves an action by its external reference (e.g. the WhatsApp approval
 * request reference) within the caller's business. Used to map an incoming
 * WhatsApp reply to the exact pending action — never "the latest pending one".
 */
export async function getActionByExternalReference(
  externalReference: string,
): Promise<ApprovalServiceResult<ApprovalAction>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("approval_actions")
    .select("*")
    .eq("business_id", context.business.id)
    .eq("external_reference", externalReference)
    .maybeSingle();

  if (error) return { ok: false, reason: "database_error" };
  if (!data) return { ok: false, reason: "not_found" };
  return { ok: true, data: mapAction(data as ApprovalActionRow) };
}

/**
 * Marks pending actions that have passed their expiry as `expired`. Called by
 * the weekly cron / a scheduled sweep so expired actions can never execute.
 */
export async function expireStaleActions(): Promise<
  ApprovalServiceResult<number>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("approval_actions")
    .update({ status: "expired" })
    .eq("business_id", context.business.id)
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) return { ok: false, reason: "database_error" };
  return { ok: true, data: ((data ?? []) as Array<{ id: string }>).length };
}
