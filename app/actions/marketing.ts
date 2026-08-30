"use server";

import { updateMarketingBudgetCap } from "@/lib/marketing/service";
import type { MarketingServiceError } from "@/lib/marketing/service";
import {
  listSocialPosts,
  type ActivityPost,
  type SocialPostServiceError,
} from "@/lib/marketing/social-posts";

export type MarketingBudgetCapActionState =
  | { ok: true; monthlyBudgetCap: number | null }
  | { ok: false; reason: MarketingServiceError };

/**
 * Server action behind the monthly ad budget cap field. The business is
 * always resolved from the authenticated session inside the service — never
 * from form data. Phase 1: plain number persistence, no payment logic.
 */
export async function updateMarketingBudgetCapAction(
  input: unknown,
): Promise<MarketingBudgetCapActionState> {
  const result = await updateMarketingBudgetCap(input);
  if (result.ok) {
    return { ok: true, monthlyBudgetCap: result.data.monthlyBudgetCap };
  }
  return { ok: false, reason: result.reason };
}

export type SocialPostListActionState =
  | { ok: true; posts: ActivityPost[] }
  | { ok: false; reason: SocialPostServiceError };

/** Real draft/published posts for the business's Marketing activity feed. */
export async function listSocialPostsAction(): Promise<SocialPostListActionState> {
  const result = await listSocialPosts();
  return result.ok
    ? { ok: true, posts: result.data }
    : { ok: false, reason: result.reason };
}

export type PublishPostActionState =
  | { ok: true; published: false; code: "not_connected" }
  | { ok: false; reason: SocialPostServiceError };

/**
 * Publish button on a draft. There is NO real Instagram/Facebook connection
 * yet (Meta credentials are not configured — see docs/phase2update.txt), so
 * this NEVER fakes a publish. It always returns the stable `not_connected`
 * code; the client maps that to the correctly localized "connect first"
 * message for the currently selected language.
 *
 * The business and its connection state are resolved server-side from the
 * authenticated session; no client-supplied id is trusted for authorization.
 */
export async function publishSocialPostAction(
  postId: string,
): Promise<PublishPostActionState> {
  // Phase 2 (reduced): publishing is intentionally blocked until a real
  // Meta connection is configured. This returns an honest status for the UI
  // to display — it does NOT write a "published" row and does NOT call any
  // fake API. A follow-up implementation will use `postId` to target the
  // exact draft once META_APP_ID / META_APP_SECRET are available.
  void postId;
  return { ok: true, published: false, code: "not_connected" };
}
