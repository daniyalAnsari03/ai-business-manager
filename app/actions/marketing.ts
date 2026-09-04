"use server";

import { updateMarketingBudgetCap } from "@/lib/marketing/service";
import type { MarketingServiceError } from "@/lib/marketing/service";
import {
  backfillMissingProductDrafts,
  listSocialPosts,
  regeneratePostCaption,
  updatePostLanguage,
  type ActivityPost,
  type BackfillResult,
  type SocialPostServiceError,
} from "@/lib/marketing/social-posts";
import { publishSocialPost } from "@/lib/marketing/instagram-publish";

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
  | { ok: true; published: true; instagramPostId: string }
  | { ok: true; published: false; code: "not_connected" | "token_expired" | "no_media" | "not_draft" | "publish_failed" | "not_found" }
  | { ok: false; reason: SocialPostServiceError };

/**
 * Publish button on a draft. Delegates to the real Instagram Content
 * Publishing API via `publishSocialPost`. The business and its connection
 * state are resolved server-side from the authenticated session; no
 * client-supplied id is trusted for authorization.
 *
 * Returns honest status codes the UI maps to localized messages:
 *   - "not_connected": no Instagram account is connected
 *   - "token_expired":  connection exists but the token expired (~60 days)
 *   - "no_media":       the post has no image
 *   - "not_draft":      already published or not a draft
 *   - "publish_failed": Instagram rejected the request
 *   - "not_found":      post does not exist or not owned by this business
 */
export async function publishSocialPostAction(
  postId: string,
): Promise<PublishPostActionState> {
  const result = await publishSocialPost(postId);

  if (result.ok) {
    return { ok: true, published: true, instagramPostId: result.instagramPostId };
  }

  // Map instagram-publish error codes to the client-recognised codes.
  const codeMap: Record<string, PublishPostActionState> = {
    no_connection: { ok: true, published: false, code: "not_connected" },
    token_expired: { ok: true, published: false, code: "token_expired" },
    no_media: { ok: true, published: false, code: "no_media" },
    not_draft: { ok: true, published: false, code: "not_draft" },
    publish_failed: { ok: true, published: false, code: "publish_failed" },
    not_found: { ok: true, published: false, code: "not_found" },
  };

  if (result.error in codeMap) {
    return codeMap[result.error];
  }

  return { ok: false, reason: "database_error" };
}

export type BackfillActionState =
  | { ok: true; data: BackfillResult }
  | { ok: false; reason: SocialPostServiceError };

/**
 * One-time, on-demand backfill (docs/phase0.txt) — triggers a draft for every
 * active product that predates automatic caption generation and therefore has
 * no `social_posts` row yet. Purposefully NOT a recurring job: it only runs
 * when called and is idempotent (already-drafted products are skipped, so a
 * second run creates no duplicates). Ownership, per-business language and RLS
 * are all handled server-side inside the service.
 */
export async function backfillProductDraftsAction(): Promise<BackfillActionState> {
  const result = await backfillMissingProductDrafts();
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, reason: result.reason };
}

export type RegeneratePostActionState =
  | { ok: true; post: ActivityPost }
  | { ok: false; reason: SocialPostServiceError };

/**
 * Regenerates both bilingual captions for an existing draft post. The AI
 * call and DB update happen server-side; ownership is resolved from the
 * authenticated session. If regeneration fails, the existing captions are
 * left intact (never wiped).
 */
export async function regeneratePostAction(
  postId: string,
): Promise<RegeneratePostActionState> {
  const result = await regeneratePostCaption(postId);
  return result.ok
    ? { ok: true, post: result.data }
    : { ok: false, reason: result.reason };
}

export type UpdatePostLanguageActionState =
  | { ok: true; post: ActivityPost }
  | { ok: false; reason: SocialPostServiceError };

/**
 * Updates the per-draft selected language (the language toggle on each card).
 * Only changes that one card's display; does not affect the global language.
 */
export async function updatePostLanguageAction(
  postId: string,
  selectedLanguage: "en" | "ur",
): Promise<UpdatePostLanguageActionState> {
  const result = await updatePostLanguage(postId, selectedLanguage);
  return result.ok
    ? { ok: true, post: result.data }
    : { ok: false, reason: result.reason };
}
