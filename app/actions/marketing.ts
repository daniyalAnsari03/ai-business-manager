"use server";

import { updateMarketingBudgetCap } from "@/lib/marketing/service";
import type { MarketingServiceError } from "@/lib/marketing/service";
import {
  backfillMissingProductDrafts,
  listSocialPosts,
  listPublishedPosts,
  regeneratePostCaption,
  updatePostLanguage,
  deletePublishedPost,
  deleteDraftPost,
  type ActivityPost,
  type BackfillResult,
  type SocialPostServiceError,
} from "@/lib/marketing/social-posts";
import { publishPost } from "@/lib/marketing/publish";

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

export type PublishedPostsActionState =
  | { ok: true; posts: ActivityPost[] }
  | { ok: false; reason: SocialPostServiceError };

/** Published posts for the business's Marketing Published section. */
export async function listPublishedPostsAction(): Promise<PublishedPostsActionState> {
  const result = await listPublishedPosts();
  return result.ok
    ? { ok: true, posts: result.data }
    : { ok: false, reason: result.reason };
}

export type PublishPostActionState =
  | PublishAttemptedActionState
  | { ok: false; reason: SocialPostServiceError };

/** Successfully published, or honestly not published (with the failed code). */
export type PublishAttemptedActionState =
  | { ok: true; published: true; platform: "instagram" | "facebook"; externalPostId: string }
  | { ok: true; published: false; platform: "instagram" | "facebook"; code: "not_connected" | "token_expired" | "no_media" | "not_draft" | "publish_failed" | "permission_missing" | "not_found" };

/**
 * Publish button on a draft. Routes to the real publisher for the post's own
 * platform — Instagram (two-step Content Publishing API) or Facebook (single-
 * step Page feed/photos API) — via `publishPost`. The business, its platform
 * and its connection state are resolved server-side from the authenticated
 * session and the post row; no client-supplied id is trusted for authorization.
 *
 * Returns honest status codes the UI maps to localized messages:
 *   - "not_connected": no account is connected for this platform
 *   - "token_expired":  connection exists but the token expired (~60 days)
 *   - "no_media":       the post has no image (Instagram-only requirement)
 *   - "not_draft":      already published or not a draft
 *   - "publish_failed": the platform rejected the request
 *   - "permission_missing": the Facebook connection lacks the permission to
 *     post (pages_manage_posts) — reconnect the Page after granting it
 *   - "not_found":      post does not exist or not owned by this business
 */
export async function publishSocialPostAction(
  postId: string,
): Promise<PublishPostActionState> {
  const result = await publishPost(postId);

  if (result.ok) {
    return {
      ok: true,
      published: true,
      platform: result.platform,
      externalPostId: result.externalPostId,
    };
  }

  // Map publish error codes to the client-recognised codes. Carry the
  // platform that was actually attempted (resolved from connected account) so
  // the UI can show the right localized message even on the failure path.
  const codeMap: Record<string, PublishAttemptedActionState> = {
    no_connection: { ok: true, published: false, platform: result.platform ?? "facebook", code: "not_connected" },
    token_expired: { ok: true, published: false, platform: result.platform ?? "facebook", code: "token_expired" },
    no_media: { ok: true, published: false, platform: result.platform ?? "instagram", code: "no_media" },
    not_draft: { ok: true, published: false, platform: result.platform ?? "facebook", code: "not_draft" },
    publish_failed: { ok: true, published: false, platform: result.platform ?? "facebook", code: "publish_failed" },
    permission_missing: { ok: true, published: false, platform: result.platform ?? "facebook", code: "permission_missing" },
    not_found: { ok: true, published: false, platform: result.platform ?? "facebook", code: "not_found" },
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

export type DeletePublishedPostActionState =
  | { ok: true; deleted: boolean }
  | { ok: false; reason: SocialPostServiceError };

/**
 * Deletes a published post from the local database only.
 * Does NOT delete the live post from Facebook/Instagram.
 */
export async function deletePublishedPostAction(
  postId: string,
): Promise<DeletePublishedPostActionState> {
  const result = await deletePublishedPost(postId);
  return result.ok
    ? { ok: true, deleted: result.data.deleted }
    : { ok: false, reason: result.reason };
}

export type DeleteDraftPostActionState =
  | { ok: true; deleted: boolean }
  | { ok: false; reason: SocialPostServiceError };

/**
 * Deletes a draft social post and cancels any pending approval actions
 * referencing it. Only draft posts can be deleted.
 */
export async function deleteDraftPostAction(
  postId: string,
): Promise<DeleteDraftPostActionState> {
  const result = await deleteDraftPost(postId);
  return result.ok
    ? { ok: true, deleted: result.data.deleted }
    : { ok: false, reason: result.reason };
}
