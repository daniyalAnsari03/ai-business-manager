import "server-only";

import type { ApprovalAction, ApprovalActionType } from "@/lib/marketing/approval-types";
import { registerExecutors } from "@/lib/marketing/approval-service";
import { publishPost } from "@/lib/marketing/publish";
import {
  recordPaymentForBusinessServiceRole,
  reversePaymentForBusinessServiceRole,
} from "@/lib/payments/service-role";
import { writeAuditLog } from "@/lib/audit/write-audit-log";

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
  permission_missing:
    "Your Facebook account is missing the permission to post to this Page. Grant the posting permission in Facebook, then reconnect the Page in Settings.",
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
    // Support both camelCase (postId) and snake_case (post_id) payload keys.
    const postId = typeof payload.postId === "string"
      ? payload.postId
      : typeof payload.post_id === "string"
        ? payload.post_id
        : null;
    if (!postId) {
      return { ok: false, error: "This post could not be identified for publishing." };
    }

    const result = await publishPost(postId, { businessId: action.businessId });

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

    // "not_draft" means the post was already published — treat as success.
    if (result.error === "not_draft") {
      return {
        ok: true,
        result: {
          published: true,
          platform: result.platform ?? "unknown",
          alreadyPublished: true,
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

  // Money movements. These run ONLY after the owner approved the action (or,
  // for money, always via approval even in full-auto). They call the
  // service-role `*_for_business` RPCs with the business id already verified
  // server-side when the action was created, and use the action id itself as
  // the idempotency key so a retry can never double-pay. No browser session is
  // required, so the in-app approval, the WhatsApp reply and a cron sweep all
  // work identically.
  record_payment: async (action) => {
    const payload = action.actionPayload as Record<string, unknown>;
    const actorId = action.approvedBy ?? action.userId;
    if (!actorId) {
      return { ok: false, error: "The approver could not be identified, so the payment was not recorded." };
    }

    const result = await recordPaymentForBusinessServiceRole({
      businessId: action.businessId,
      actorId,
      payload: {
        orderId: payload.orderId ?? undefined,
        supplierBillId: payload.supplierBillId ?? undefined,
        amount: payload.amount,
        method: payload.method,
        paidAt: payload.paidAt ?? undefined,
        reference: payload.reference ?? undefined,
        notes: payload.notes ?? undefined,
        idempotencyKey: action.id,
      },
    });

    if (!result.ok) {
      return { ok: false, error: moneyError(result.reason) };
    }

    const data = result.data as Record<string, unknown>;
    const payment = data.payment as { id?: string } | undefined;
    const replayed = data.idempotent_replay === true;

    // Audit only a genuinely new, confirmed payment (a replay already logged).
    if (!replayed) {
      await writeAuditLog({
        businessId: action.businessId,
        actorType: "ai",
        actorId,
        action: "payment.create",
        entity: "payment",
        entityId: payment?.id ?? null,
        after: {
          orderId: (data.orderId as string | null) ?? (payload.orderId as string | null) ?? null,
          supplierBillId: (data.supplierBillId as string | null) ?? (payload.supplierBillId as string | null) ?? null,
          amount: payload.amount,
          method: payload.method,
        },
      });
    }

    return {
      ok: true,
      result: {
        paymentId: payment?.id ?? null,
        orderId: data.orderId ?? payload.orderId ?? null,
        supplierBillId: data.supplierBillId ?? payload.supplierBillId ?? null,
        paid: data.paid ?? null,
        due: data.due ?? null,
        paidAmount: data.paidAmount ?? null,
        idempotentReplay: replayed,
      },
    };
  },

  reverse_payment: async (action) => {
    const payload = action.actionPayload as Record<string, unknown>;
    const actorId = action.approvedBy ?? action.userId;
    if (!actorId) {
      return { ok: false, error: "The approver could not be identified, so the payment was not cancelled." };
    }
    const paymentId = typeof payload.paymentId === "string" ? payload.paymentId : null;
    const reason = typeof payload.reason === "string" ? payload.reason : "";
    if (!paymentId || !reason.trim()) {
      return { ok: false, error: "The payment or reason could not be identified, so it was not cancelled." };
    }

    const result = await reversePaymentForBusinessServiceRole({
      businessId: action.businessId,
      actorId,
      paymentId,
      reason,
      idempotencyKey: action.id,
    });

    if (!result.ok) {
      return { ok: false, error: moneyError(result.reason) };
    }

    const data = result.data as Record<string, unknown>;
    const payment = data.payment as { id?: string } | undefined;
    const replayed = data.idempotent_replay === true;

    if (!replayed) {
      await writeAuditLog({
        businessId: action.businessId,
        actorType: "ai",
        actorId,
        action: "payment.reverse",
        entity: "payment",
        entityId: (data.reversedPaymentId as string | null) ?? paymentId,
        reason,
        after: { reversalPaymentId: payment?.id ?? null },
      });
    }

    return {
      ok: true,
      result: {
        reversalPaymentId: payment?.id ?? null,
        reversedPaymentId: data.reversedPaymentId ?? paymentId,
        orderId: data.orderId ?? null,
        supplierBillId: data.supplierBillId ?? null,
        paid: data.paid ?? null,
        due: data.due ?? null,
        idempotentReplay: replayed,
      },
    };
  },

  other: async () => {
    return { ok: false, error: "This action type has no executor yet." };
  },
};

/** Turns a money-service error reason into a clear owner-facing sentence. */
function moneyError(reason: string): string {
  const messages: Record<string, string> = {
    order_cancelled: "This order is cancelled, so the payment was not recorded.",
    no_due: "There is nothing left to pay on this target.",
    overpayment: "The amount is more than the outstanding due, so the payment was not recorded.",
    not_found: "The target could not be found. It may have been deleted.",
    not_reversible: "This payment cannot be cancelled.",
    already_reversed: "This payment was already cancelled.",
    negative_paid: "Cancelling this payment would make the paid amount negative, so it was not done.",
    idempotency_conflict: "This request conflicts with an earlier payment. It was not recorded twice.",
    invalid_amount: "The amount is not valid.",
    invalid_method: "The payment method is not valid.",
    actor_required: "The approver could not be identified.",
  };
  return messages[reason] ?? "The payment action could not be completed.";
}

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
