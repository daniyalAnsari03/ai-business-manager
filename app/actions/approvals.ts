"use server";

import {
  approveAction,
  rejectAction,
  listReviewableActions,
  listApprovalHistory,
  type ApprovalServiceError,
} from "@/lib/marketing/approval-service";
import type {
  ApprovalAction,
  ReviewableAction,
} from "@/lib/marketing/approval-types";

export type ReviewableActionsActionState =
  | { ok: true; actions: ReviewableAction[] }
  | { ok: false; reason: ApprovalServiceError };

/** Pending actions for the in-app Review screen. */
export async function listReviewableActionsAction(): Promise<ReviewableActionsActionState> {
  const result = await listReviewableActions();
  return result.ok
    ? { ok: true, actions: result.data }
    : { ok: false, reason: result.reason };
}

export type ApprovalHistoryActionState =
  | { ok: true; actions: ApprovalAction[] }
  | { ok: false; reason: ApprovalServiceError };

/** Full approval history (pending / approved / rejected / completed / failed...). */
export async function listApprovalHistoryAction(
  limit?: number,
): Promise<ApprovalHistoryActionState> {
  const result = await listApprovalHistory(limit);
  return result.ok
    ? { ok: true, actions: result.data }
    : { ok: false, reason: result.reason };
}

export type ApproveActionState =
  | { ok: true; action: ApprovalAction }
  | { ok: false; reason: ApprovalServiceError };

/** Approves a pending action for the caller's business and executes it once. */
export async function approveActionAction(
  actionId: string,
): Promise<ApproveActionState> {
  const result = await approveAction(actionId);
  return result.ok
    ? { ok: true, action: result.data }
    : { ok: false, reason: result.reason };
}

export type RejectActionState =
  | { ok: true; action: ApprovalAction }
  | { ok: false; reason: ApprovalServiceError };

/** Rejects a pending action. A rejected action can never execute. */
export async function rejectActionAction(
  actionId: string,
): Promise<RejectActionState> {
  const result = await rejectAction(actionId);
  return result.ok
    ? { ok: true, action: result.data }
    : { ok: false, reason: result.reason };
}
