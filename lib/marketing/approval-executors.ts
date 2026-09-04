import "server-only";

import type { ApprovalAction, ApprovalActionType } from "@/lib/marketing/approval-types";
import { registerExecutors } from "@/lib/marketing/approval-service";

/**
 * Real executors for each approval action type.
 *
 * An executor is the actual business work performed exactly once when an
 * approved/eligible action is executed. It must return a truthful result:
 *   - { ok: true, result }  when the action genuinely succeeded.
 *   - { ok: false, error }  when it failed (e.g. no platform connection),
 *                           which the engine records as a `failed` execution.
 *
 * Phase 4 has no real Meta/WhatsApp publishing credentials configured, so the
 * publish-spoke executors honestly report that the target channel is not yet
 * connected rather than pretending to publish. The approval framework itself
 * is fully real: actions are created, reviewed, approved/rejected and
 * executed exactly once through the idempotent engine.
 */

export type ApprovalExecutor = (
  action: ApprovalAction,
) => Promise<{ ok: boolean; result?: unknown; error?: string }>;

export type ApprovalExecutorRegistry = Partial<
  Record<ApprovalActionType, ApprovalExecutor>
>;

/** Whether a real publishing connection exists. */
function isPlatformConnected(): boolean {
  // Phase 4: no real channel credentials are configured, so publishing is
  // never claimed. This is intentionally honest — a follow-up phase wires a
  // real connection and flips this check to a live lookup.
  return false;
}

const executors: ApprovalExecutorRegistry = {
  publish_social_post: async (action) => {
    const payload = action.actionPayload as Record<string, unknown>;
    const platform = typeof payload.platform === "string" ? payload.platform : "instagram";
    if (!isPlatformConnected()) {
      return {
        ok: false,
        error: `Your ${platform} account is not connected yet, so the post could not be published.`,
      };
    }
    return {
      ok: true,
      result: { published: true, platform, actionId: action.id },
    };
  },

  publish_video: async (action) => {
    const payload = action.actionPayload as Record<string, unknown>;
    const platform = typeof payload.platform === "string" ? payload.platform : "instagram";
    if (!isPlatformConnected()) {
      return {
        ok: false,
        error: `Your ${platform} account is not connected yet, so the video could not be published.`,
      };
    }
    return {
      ok: true,
      result: { published: true, platform, actionId: action.id },
    };
  },

  create_ad_campaign: async () => {
    // Sensitive (money) action — always routed through approval. No real ad
    // platform connection exists, so creating a live campaign is not possible.
    return {
      ok: false,
      error: "No ads account is connected yet, so the campaign could not be created.",
    };
  },

  spend_wallet: async () => {
    // Wallet spend must respect the existing budget/balance ledger. Phase 4
    // does not auto-debit; real ad spend arrives with a connected ads account.
    return {
      ok: false,
      error: "Ad spend cannot be deducted until a live ads account is connected.",
    };
  },

  other: async () => {
    return { ok: false, error: "This action type has no executor yet." };
  },
};

/**
 * Wire the registry into the approval service. Called once on module load
 * from wherever the services / agent tools build their tool surface.
 */
export function configureApprovalExecutors(): void {
  registerExecutors(executors);
}

/** Direct access to the executor registry (used by the webhook path). */
export function getApprovalExecutors(): ApprovalExecutorRegistry {
  return executors;
}
