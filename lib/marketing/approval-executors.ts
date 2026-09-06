import "server-only";

import type { ApprovalAction, ApprovalActionType } from "@/lib/marketing/approval-types";
import { registerExecutors } from "@/lib/marketing/approval-service";
import { publishPost } from "@/lib/marketing/publish";

/**
 * Real executors for each approval action type.
 *
 * An executor is the actual business work performed exactly once when an
 * approved/eligible action is executed. It must return a truthful result:
 *   - { ok: true, result }  when the action genuinely succeeded.
 *   - { ok: false, error }  when it failed (e.g. no platform connection),
 *                           which the engine records as a `failed` execution.
 *
 * The publish executor now performs REAL publishing via the post's own
 * platform — Instagram (two-step Content Publishing API) or Facebook (single-
 * step Page feed/photos API). On success the social_posts row is updated to
 * "published" with a real timestamp and the platform post id. On failure it is
 * updated to "failed" with the honest error reason logged server-side.
 *
 * Token lifetime note: Instagram/Facebook long-lived tokens last ~60 days.
 * When a token expires the user must re-connect via Settings → Connect.
 */

export type ApprovalExecutor = (
  action: ApprovalAction,
) => Promise<{ ok: boolean; result?: unknown; error?: string }>;

export type ApprovalExecutorRegistry = Partial<
  Record<ApprovalActionType, ApprovalExecutor>
>;

const USER_FRIENDLY_ERRORS: Record<string, string> = {
  no_connection:
    "Your Instagram or Facebook account is not connected, so the post could not be published. Please connect it in Settings first.",
  token_expired:
    "Your Instagram or Facebook connection has expired. Please reconnect your account in Settings to publish again.",
  no_media:
    "This post has no image attached, so it cannot be published to Instagram.",
  not_draft:
    "This post has already been published or is no longer a draft.",
  not_found:
    "The post could not be found. It may have been deleted.",
  publish_failed:
    "Instagram or Facebook rejected the publish request. The image or caption may not meet the platform's requirements.",
  no_business:
    "Could not determine your business. Please try again.",
  unauthenticated:
    "You are not signed in. Please sign in and try again.",
  not_configured:
    "Publishing is not available right now. Please try again later.",
  database_error:
    "A system error occurred while saving the result. The post may or may not be live on the platform.",
};

const executors: ApprovalExecutorRegistry = {
  publish_social_post: async (action) => {
    const payload = action.actionPayload as Record<string, unknown>;
    const postId = typeof payload.post_id === "string" ? payload.post_id : null;
    if (!postId) {
      return { ok: false, error: "This post could not be identified for publishing." };
    }

    const result = await publishPost(postId);

    if (result.ok) {
      return {
        ok: true,
        result: {
          published: true,
          platform: result.platform,
          externalPostId: result.externalPostId,
          actionId: action.id,
        },
      };
    }

    const friendlyMessage =
      USER_FRIENDLY_ERRORS[result.error] ??
      "The post could not be published. Please try again later.";

    return { ok: false, error: friendlyMessage };
  },

  publish_video: async (action) => {
    const payload = action.actionPayload as Record<string, unknown>;
    const platform = typeof payload.platform === "string" ? payload.platform : "instagram";
    return {
      ok: false,
      error: `Video publishing to ${platform} is not yet supported. Coming soon.`,
    };
  },

  create_ad_campaign: async () => {
    return {
      ok: false,
      error: "No ads account is connected yet, so the campaign could not be created.",
    };
  },

  spend_wallet: async () => {
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
