import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import { toolFail, toolOk } from "@/lib/ai/tools/shared";
import {
  configureApprovalExecutors,
} from "@/lib/marketing/approval-executors";
import {
  decideAndRunAction,
  findExistingActionByPostId,
  executeApprovedAction,
} from "@/lib/marketing/approval-service";
import { getAutomationMode } from "@/lib/marketing/automation";

/**
 * Approval-aware marketing tools for the AI Business Manager (Phase 4).
 *
 * Instead of publishing directly (which would bypass the owner's automation
 * rules), these tools route publishing through the approval action engine:
 *
 *   AI decides to publish  ->  decideAndRunAction  ->  parked OR auto-executes
 *
 * In `needs_approval` mode a pending action is created and returned so the AI
 * can tell the user it is waiting for approval (and a WhatsApp request is sent
 * when connected). In `full_auto` mode an eligible (safe) action runs
 * immediately through the idempotent engine. Sensitive actions (money / ad
 * spend) always require approval regardless of mode.
 */

let registered = false;
function ensureExecutors(): void {
  if (!registered) {
    configureApprovalExecutors();
    registered = true;
  }
}

export const publishSocialPostTool = tool({
  name: "publish_social_post",
  description:
    "Publish a drafted social post. Routes the request through the business's automation control: in 'needs approval' mode it creates a pending approval the owner must confirm in-app or by WhatsApp; in 'full auto' mode it executes immediately when the action is safe. Never publishes without the owner's automation rules being respected.",
  parameters: z.object({
    postId: z.string().trim().min(1).max(60).describe("The id of the drafted social post to publish."),
    productName: z.string().trim().max(160).optional().describe("The product name for this post. Used in approval history."),
    platform: z
      .enum(["instagram", "facebook"])
      .optional()
      .describe("The platform to publish to. Defaults to the post's platform."),
  }),
  execute: async ({ postId, productName, platform }) => {
    ensureExecutors();
    const modeResult = await getAutomationMode();
    if (!modeResult.ok) {
      return toolFail("database_error", "Could not read the automation setting. Ask the user to try again.");
    }
    const mode = modeResult.data;

    const result = await decideAndRunAction({
      actionType: "publish_social_post",
      payload: {
        postId,
        platform: platform ?? "instagram",
        productName: productName ?? null,
        source: "agent",
      },
      summary: productName
        ? `Publish "${productName}" to ${platform ?? "facebook"}.`
        : `Publish the social post to ${platform ?? "facebook"}.`,
      idempotencyKey: `post-publish-${postId}`,
      executor: () => Promise.resolve({ ok: true, result: { postId, platform: platform ?? "instagram" } }),
    });

    if (!result.ok) {
      return toolFail("database_error", "The action could not be prepared right now. Do not claim success.");
    }

    if (result.data.outcome === "needs_approval") {
      return toolOk({
        outcome: "needs_approval",
        mode,
        postId,
        message: "This post requires your approval before publishing. Go to Marketing → Approvals to review and approve it. You will see the product name, platform, and caption there.",
      });
    }

    const action = result.data.action;
    const execResult = action.executionResult as Record<string, unknown> | null;
    const wasPublished = execResult?.published === true || action.status === "completed";
    const wasAlreadyPublished = execResult?.alreadyPublished === true;
    const publishFailed = action.status === "failed";

    let message: string;
    if (wasAlreadyPublished) {
      message = "This post was already published earlier.";
    } else if (wasPublished) {
      const pubPlatform = (execResult?.platform as string) ?? platform ?? "the platform";
      message = `The post was published to ${pubPlatform} successfully.`;
    } else if (publishFailed) {
      message = `Publishing failed: ${action.executionError ?? "unknown reason"}. Do NOT tell the user it was published.`;
    } else {
      message = `Publishing did not complete: ${action.executionError ?? "unknown reason"}.`;
    }

    return toolOk({
      outcome: publishFailed ? "failed" : action.status === "completed" ? "executed" : action.status,
      published: wasPublished,
      platform: (execResult?.platform as string) ?? platform ?? null,
      externalPostId: (execResult?.externalPostId as string) ?? null,
      mode,
      execution_result: execResult,
      message,
    });
  },
});

export const getAutomationModeTool = tool({
  name: "get_automation_mode",
  description:
    "Reads whether this business runs in 'needs approval' or 'full auto' automation mode. Use before any publish/ad/spend action to explain to the user whether the action needs their approval or can run automatically.",
  parameters: z.object({}),
  execute: async () => {
    const result = await getAutomationMode();
    if (!result.ok) {
      return toolFail("database_error", "Could not read the automation setting.");
    }
    return toolOk({
      mode: result.data,
      explanation:
        result.data === "needs_approval"
          ? "AI prepares actions and asks you before publishing, spending money, or performing sensitive marketing actions."
          : "AI can execute eligible actions automatically according to your configured rules.",
    });
  },
});

/**
 * Checks whether an approval action already exists for a given social post.
 * Use this BEFORE calling publish_social_post when the user references a
 * post that may already have an approval in flight (pending, approved, or
 * executing). This prevents duplicate approvals.
 */
export const findApprovalActionTool = tool({
  name: "find_approval_action",
  description:
    "Check whether an approval action already exists for a given social post (by postId). Use this when the user says they already approved something, or when you suspect a publish request for the same post may already be in the approval pipeline. Returns the existing action with its current status (pending, approved, executing) or null if none exists.",
  parameters: z.object({
    postId: z.string().trim().min(1).max(60).describe("The social post id to check."),
  }),
  execute: async ({ postId }) => {
    ensureExecutors();
    const result = await findExistingActionByPostId(postId);
    if (!result.ok) {
      return toolFail("database_error", "Could not check for existing approvals.");
    }
    if (!result.data) {
      return toolOk({
        found: false,
        postId,
        message: "No existing approval action found for this post.",
      });
    }
    const action = result.data;
    return toolOk({
      found: true,
      actionId: action.id,
      status: action.status,
      summary: action.summary,
      createdAt: action.createdAt,
      approvedAt: action.approvedAt,
      executedAt: action.executedAt,
      postId,
      message:
        action.status === "approved"
          ? "An approval already exists and is approved. Use execute_approved_action to publish it now."
          : action.status === "pending"
            ? "An approval action is still pending. The user must approve it in Marketing → Approvals before it can execute."
            : action.status === "executing"
              ? "The action is currently executing. Wait for the result."
              : `Existing action has status: ${action.status}.`,
    });
  },
});

/**
 * Executes an already-approved (or pending) approval action. Use this when
 * the user says "I already approved it, now publish" — find the action first
 * with find_approval_action, then execute it with this tool.
 */
export const executeApprovedActionTool = tool({
  name: "execute_approved_action",
  description:
    "Execute an approval action that was already approved by the user. Use this when the user says they already approved a publish action and wants it published now. The action must be found first using find_approval_action. This triggers the real Facebook/Instagram publish.",
  parameters: z.object({
    actionId: z.string().trim().min(1).max(60).describe("The approval action id to execute."),
  }),
  execute: async ({ actionId }) => {
    ensureExecutors();
    const result = await executeApprovedAction(actionId);
    if (!result.ok) {
      const messages: Record<string, string> = {
        unauthorized: "Could not verify this action belongs to your business.",
        not_pending: "This action cannot be executed — it was rejected or cancelled.",
        expired: "This approval has expired. The user must request a new publish action.",
        database_error: "A system error occurred. Please try again.",
      };
      return toolFail(result.reason, messages[result.reason] ?? "Could not execute the action.");
    }

    const action = result.data;
    const execResult = action.executionResult as Record<string, unknown> | null;
    const wasPublished = execResult?.published === true || action.status === "completed";
    const wasAlreadyPublished = execResult?.alreadyPublished === true;
    const publishFailed = action.status === "failed";

    let message: string;
    if (wasAlreadyPublished) {
      message = "This post was already published earlier.";
    } else if (wasPublished) {
      const pubPlatform = (execResult?.platform as string) ?? "the platform";
      message = `The post was published to ${pubPlatform} successfully.`;
    } else if (publishFailed) {
      message = `Publishing failed: ${action.executionError ?? "unknown reason"}. Do NOT tell the user it was published.`;
    } else {
      message = `Action status: ${action.status}. ${action.executionError ? `Error: ${action.executionError}` : ""}`;
    }

    return toolOk({
      outcome: publishFailed ? "failed" : action.status === "completed" ? "executed" : action.status,
      published: wasPublished,
      platform: (execResult?.platform as string) ?? null,
      externalPostId: (execResult?.externalPostId as string) ?? null,
      execution_result: execResult,
      message,
    });
  },
});
