import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import { toolFail, toolOk } from "@/lib/ai/tools/shared";
import {
  configureApprovalExecutors,
} from "@/lib/marketing/approval-executors";
import { decideAndRunAction } from "@/lib/marketing/approval-service";
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
    platform: z
      .enum(["instagram", "facebook"])
      .optional()
      .describe("The platform to publish to. Defaults to the post's platform."),
  }),
  execute: async ({ postId, platform }) => {
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
        source: "agent",
      },
      summary: `Publish the social post and share it to ${platform ?? "instagram"}.`,
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
        message: "This action is waiting for your approval. Please review it in the Approval section (or reply YES/NO on WhatsApp if you connected it).",
      });
    }

    const action = result.data.action;
    return toolOk({
      outcome: action.status === "completed" ? "executed" : action.status,
      mode,
      execution_result: action.executionResult ?? null,
      message: action.status === "completed"
        ? "The post was published."
        : `Publishing did not complete: ${action.executionError ?? "unknown reason"}.`,
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
