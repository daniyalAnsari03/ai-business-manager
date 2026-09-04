/**
 * Phase 4 approval + automation types.
 *
 * The approval action engine is the persistent record of a decision the AI
 * wants to make. These types describe what is stored (see the
 * `approval_actions` migration) and the language used across the service, the
 * Review UI, the WhatsApp approval flow and the agent tools.
 */

export const AUTOMATION_MODES = ["needs_approval", "full_auto"] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export const APPROVAL_ACTION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "executing",
  "completed",
  "failed",
  "expired",
  "cancelled",
] as const;
export type ApprovalActionStatus = (typeof APPROVAL_ACTION_STATUSES)[number];

/** A controlled business action the AI can request approval for (or run). */
export type ApprovalActionType =
  | "publish_social_post"
  | "create_ad_campaign"
  | "spend_wallet"
  | "publish_video"
  | "other";

export interface ApprovalAction {
  id: string;
  businessId: string;
  userId: string | null;
  actionType: ApprovalActionType;
  actionPayload: Record<string, unknown>;
  summary: string;
  approvalMode: AutomationMode;
  status: ApprovalActionStatus;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  approvedBy: string | null;
  rejectedBy: string | null;
  executedAt: string | null;
  executionResult: Record<string, unknown> | null;
  executionError: string | null;
  externalReference: string | null;
}

export interface ApprovalEvent {
  id: string;
  approvalActionId: string;
  businessId: string;
  event: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

/** A pending action shown in the in-app Review list, with friendly context. */
export interface ReviewableAction {
  id: string;
  actionType: ApprovalActionType;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
  expiresAt: string | null;
  hasExpired: boolean;
  /* Eventual publish target used for the action description. */
  platform?: string | null;
  /* Linked product name when the action promotes one. */
  productName?: string | null;
  /* Scheduled time when the action has one. */
  scheduledAt?: string | null;
}

/**
 * Input for creating a new approval action. `summary` must already be in the
 * business's selected language (the caller composes it through the dictionary
 * or the agent's language-aware instruction). `executor` is a server-side
 * function invoked exactly once when the action is approved (or when running
 * automatically in full-auto mode).
 */
export interface CreateApprovalActionInput {
  actionType: ApprovalActionType;
  payload: Record<string, unknown>;
  summary: string;
  /** Correlation id used for idempotency + WhatsApp mapping (unique per business). */
  idempotencyKey: string;
  executor: (actionId: string) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
}

/**
 * Safety classification for an action type. Full-auto mode may only auto-run
 * actions that are NOT money/destructive/sensitive; everything else must go
 * through approval even in full-auto (per AGENTS.md section 8).
 */
export const APPROVAL_ACTION_SENSITIVITY: Record<
  ApprovalActionType,
  "safe" | "sensitive"
> = {
  publish_social_post: "safe",
  publish_video: "safe",
  create_ad_campaign: "sensitive",
  spend_wallet: "sensitive",
  other: "safe",
};

/** Whether an action type may run automatically in full-auto mode. */
export function isActionEligibleForAuto(actionType: ApprovalActionType): boolean {
  return APPROVAL_ACTION_SENSITIVITY[actionType] === "safe";
}
