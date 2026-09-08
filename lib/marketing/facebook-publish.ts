import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import { getUserBusiness } from "@/lib/business/service";
import { getMetaAppConfig } from "@/lib/marketing/meta-config";
import { resolvePageAccessToken } from "@/lib/marketing/meta-oauth";

/**
 * Real Facebook Page Content Publishing — the single-step Graph API flow.
 *
 *   Text/link post: POST /{page-id}/feed     with `message` (+ optional `link`)
 *   Photo post:     POST /{page-id}/photos   with `url` + `caption`
 *
 * Unlike Instagram there is no media-container step — Meta creates the post in
 * the same call and returns the post id immediately. Auth is the Page-level
 * token (from the connected Facebook account, see lib/marketing/meta-oauth.ts);
 * every call runs on graph.facebook.com.
 *
 * Only reached when a connected Facebook account exists with a valid token.
 * Token lifetime: ~60 days for long-lived tokens — reconnection eventually
 * needed.
 */

type SocialPostRow = {
  id: string;
  business_id: string;
  product_id: string | null;
  platform: string;
  caption: string | null;
  caption_ur: string | null;
  caption_en: string | null;
  selected_language: string;
  media_url: string | null;
  status: string;
};

type ConnectedAccountRow = {
  id: string;
  business_id: string;
  platform: string;
  status: string;
  account_label: string | null;
  access_token: string | null;
  token_expires_at: string | null;
  external_account_id: string | null;
};

export type FacebookPublishErrorCode =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "not_found"
  | "not_draft"
  | "no_connection"
  | "token_expired"
  | "permission_missing"
  | "publish_failed"
  | "database_error";

export type FacebookPublishResult =
  | { ok: true; facebookPostId: string }
  | { ok: false; error: FacebookPublishErrorCode; detail?: string };

async function getBusinessContext(): Promise<
  | { ok: true; supabase: SupabaseClient; businessId: string }
  | { ok: false; error: FacebookPublishErrorCode }
> {
  let user;
  let supabase: SupabaseClient;
  try {
    user = await getServerUser();
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, error: "not_configured" };
  }
  if (!user) return { ok: false, error: "unauthenticated" };

  const business = await getUserBusiness();
  if (!business) return { ok: false, error: "no_business" };

  return { ok: true, supabase, businessId: business.id };
}

/**
 * Fetches the Facebook connected_accounts row for this business, including
 * the access_token and external_account_id (Page id). Returns null when no
 * connection exists.
 */
async function getFacebookConnection(
  supabase: SupabaseClient,
  businessId: string,
): Promise<ConnectedAccountRow | null> {
  const { data } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("business_id", businessId)
    .eq("platform", "facebook")
    .eq("status", "connected")
    .maybeSingle();

  return (data as ConnectedAccountRow | null) ?? null;
}

function isTokenExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

interface FacebookApiResponse {
  id?: string;
  post_id?: string;
  error?: { message?: string; type?: string; code?: number };
}

type PagePublishFailure = {
  ok: false;
  error: string;
  errorCode?: number;
  metaType?: string;
};

/**
 * Single-step Facebook Page publish.
 *
 * With an image the post goes to /{page-id}/photos (url + caption). Without
 * one it goes to /{page-id}/feed (message). Meta returns the post id directly
 * in the same call — there is no container step like Instagram.
 *
 * The access token MUST be a Page-scoped token for the page being posted to
 * (see publishFacebookPost, which resolves it from /me/accounts). A user
 * access token that lacks pages_manage_posts is rejected by Meta with
 * OAuthException code 200.
 *
 * @returns the Facebook post id on success.
 */
async function publishToFacebookPage(
  pageId: string,
  accessToken: string,
  caption: string,
  mediaUrl: string | null,
): Promise<{ ok: true; facebookPostId: string } | PagePublishFailure> {
  const cfg = getMetaAppConfig();
  if (!cfg)
    return { ok: false, error: "Meta not configured.", errorCode: 0 };

  const path = mediaUrl ? `/${pageId}/photos` : `/${pageId}/feed`;
  const publishUrl = new URL(`${cfg.graphApiBase}${path}`);
  publishUrl.searchParams.set("access_token", accessToken);

  if (mediaUrl) {
    // Photo post — the photo must be reachable from a public URL.
    publishUrl.searchParams.set("url", mediaUrl);
    // `caption` is the current parameter for a photo's description; `message`
    // is deprecated for photos (verified against Meta's Page photos docs).
    publishUrl.searchParams.set("caption", caption);
  } else {
    publishUrl.searchParams.set("message", caption);
  }

  console.log(
    `[FB-Publish] publishing to page: ${pageId} via: ${path} image=${!!mediaUrl}`,
  );

  let publishRes: Response;
  try {
    publishRes = await fetch(publishUrl.toString(), { method: "POST" });
  } catch (e) {
    console.log("[FB-Publish] FETCH ERROR:", e);
    return { ok: false, error: "Could not reach Facebook.", errorCode: 0 };
  }

  let publishJson: FacebookApiResponse;
  try {
    publishJson = (await publishRes.json()) as FacebookApiResponse;
  } catch (e) {
    console.log("[FB-Publish] JSON PARSE ERROR:", e);
    return {
      ok: false,
      error: "Unexpected response from Facebook.",
      errorCode: 0,
    };
  }

  console.log(
    `[FB-Publish] HTTP status=${publishRes.status} has_id=${!!publishJson?.id} has_post_id=${!!publishJson?.post_id}`,
  );
  if (publishJson?.error) {
    console.log("[FB-Publish] error:", JSON.stringify(publishJson.error));
    return {
      ok: false,
      error: publishJson.error.message ?? "Publishing failed.",
      errorCode: publishJson.error.code,
      metaType: publishJson.error.type,
    };
  }

  // Photo posts return both photo `id` and `post_id`; the post_id is the real
  // Facebook post reference. Text/link posts return `id` directly.
  const facebookPostId = publishJson?.post_id ?? publishJson?.id;
  if (!facebookPostId) {
    return {
      ok: false,
      error: "Facebook did not return a post ID.",
      errorCode: 0,
    };
  }

  return { ok: true, facebookPostId };
}

/**
 * Publish a social post to a Facebook Page via the single-step Graph API.
 *
 * Called by both the direct UI "Publish" button and the approval executor
 * (through the shared platform dispatcher). After a successful publish the
 * social_posts row is updated to status "published" with a real timestamp and
 * the real Facebook post id stored in external_post_reference.
 *
 * On failure the row is updated to "failed" with the honest error reason
 * logged server-side (never exposed raw to the UI — callers translate it).
 *
 * Token lifetime note: Instagram/Facebook long-lived tokens last ~60 days.
 * When a token expires the user must re-connect via Settings → Connect.
 */
export async function publishFacebookPost(
  postId: string,
): Promise<FacebookPublishResult> {
  const ctx = await getBusinessContext();
  if (!ctx.ok) return ctx;

  const { supabase, businessId } = ctx;

  // 1. Read the draft post — verify ownership via RLS.
  const { data: postRow, error: postError } = await supabase
    .from("social_posts")
    .select("id, business_id, product_id, platform, caption, caption_ur, caption_en, selected_language, media_url, status")
    .eq("id", postId)
    .eq("business_id", businessId)
    .single();

  if (postError || !postRow) {
    console.log("[FB-Publish] Post not found or not owned by this business:", postId);
    return { ok: false, error: "not_found" };
  }

  const post = postRow as SocialPostRow;

  if (post.status !== "draft") {
    return { ok: false, error: "not_draft" };
  }

  // 2. Read the Facebook connection — verify a connected account exists.
  const connection = await getFacebookConnection(supabase, businessId);
  if (!connection) {
    return { ok: false, error: "no_connection" };
  }

  if (!connection.access_token || !connection.external_account_id) {
    return { ok: false, error: "no_connection" };
  }

  // 3. Check token expiry.
  if (isTokenExpired(connection.token_expires_at)) {
    console.log("[FB-Publish] Token expired for connection:", connection.id);
    return { ok: false, error: "token_expired" };
  }

  // 3b. Select the caption for the selected language.
  const caption =
    post.selected_language === "ur"
      ? (post.caption_ur ?? post.caption ?? "")
      : (post.caption_en ?? post.caption ?? "");

  // 3c. Page posts MUST be signed with a PAGE-scoped token, never a user
  // token. The connect flow now stores the Page token; older connections
  // stored the user token, so when possible resolve the Page's own token from
  // /me/accounts at publish time and fall back to the stored token.
  const cfg = getMetaAppConfig();
  const pageToken = cfg
    ? await resolvePageAccessToken(
        cfg,
        connection.access_token,
        connection.external_account_id,
      )
    : null;
  const publishToken = pageToken ?? connection.access_token;
  const tokenKind = pageToken ? "page" : "stored";

  // 5. Single-step Facebook publish (feed for text, photos for an image).
  const result = await publishToFacebookPage(
    connection.external_account_id,
    publishToken,
    caption,
    post.media_url,
  );

  if (!result.ok) {
    // Classify the real reason so the UI can show it instead of a generic
    // failure. Meta's OAuthException (code 200) naming pages_manage_posts is
    // the missing-permission case — the token (user or page kind) simply lacks
    // the permission to post. Everything else is a platform rejection.
    const missingPermission =
      result.errorCode === 200 &&
      /pages_manage_posts/i.test(result.error ?? "");
    console.error(
      `[FB-Publish] FAILED for post: ${postId} token=${tokenKind} error_code=${
        result.errorCode ?? "n/a"
      } error_type=${result.metaType ?? "n/a"} error=${result.error}`,
    );
    // Update to failed — log the real error server-side only.
    const failedPayload = {
      status: "failed",
      updated_at: new Date().toISOString(),
    };
    const { error: failUpdateError } = await supabase
      .from("social_posts")
      .update(failedPayload)
      .eq("id", postId)
      .eq("business_id", businessId);
    if (failUpdateError) {
      console.error("[FB-Publish] DB update to failed also failed:", failUpdateError);
    }
    if (missingPermission) {
      return { ok: false, error: "permission_missing", detail: result.error };
    }
    return { ok: false, error: "publish_failed", detail: result.error };
  }

  // 6. Update to published with the real Facebook post ID.
  //    This is CRITICAL — Marketing Activity reads social_posts.status to
  //    determine Draft vs Published. If this update fails, the approval
  //    action is marked completed but the UI still shows "Draft".
  const now = new Date().toISOString();
  const updatePayload = {
    status: "published",
    published_at: now,
    updated_at: now,
    external_post_reference: result.facebookPostId,
  };

  let { error: updateError } = await supabase
    .from("social_posts")
    .update(updatePayload)
    .eq("id", postId)
    .eq("business_id", businessId);

  // Retry once if the first update failed — the canonical status MUST be
  // persisted for Marketing Activity to show "Published".
  if (updateError) {
    console.error("[FB-Publish] DB update failed after publish, retrying:", updateError);
    const retry = await supabase
      .from("social_posts")
      .update(updatePayload)
      .eq("id", postId)
      .eq("business_id", businessId);
    if (retry.error) {
      // The post IS live on Facebook but our DB status is still "draft".
      // Log as critical — the user will see the post on Facebook but our
      // UI will incorrectly show "Draft". A manual DB fix or re-sync is needed.
      console.error("[FB-Publish] CRITICAL: DB update retry also failed:", retry.error);
    }
    updateError = retry.error;
  }

  console.log("[FB-Publish] SUCCESS — post:", postId, "FB id:", result.facebookPostId);
  return { ok: true, facebookPostId: result.facebookPostId };
}