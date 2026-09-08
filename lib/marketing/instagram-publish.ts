import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import { getUserBusiness } from "@/lib/business/service";
import { getMetaAppConfig } from "@/lib/marketing/meta-config";

/**
 * Real Instagram Content Publishing — the two-step Graph API flow.
 *
 *   Step A: POST /{ig-user-id}/media  → creates a media container, returns id
 *   Step B: POST /{ig-user-id}/media_publish with that id → publishes live
 *
 * The token comes from "Instagram API with Facebook Login" (see
 * lib/marketing/meta-oauth.ts), so every call runs on graph.facebook.com — the
 * host Meta requires for Facebook-Login-issued Instagram tokens.
 *
 * Only reached when a connected Instagram account exists with a valid token.
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

export type PublishErrorCode =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "not_found"
  | "not_draft"
  | "no_media"
  | "no_connection"
  | "token_expired"
  | "container_failed"
  | "publish_failed"
  | "database_error";

export type PublishResult =
  | { ok: true; instagramPostId: string }
  | { ok: false; error: PublishErrorCode; detail?: string };

async function getBusinessContext(): Promise<
  | { ok: true; supabase: SupabaseClient; businessId: string }
  | { ok: false; error: PublishErrorCode }
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
 * Fetches the Instagram connected_accounts row for this business, including
 * the access_token and external_account_id (IG user id). Returns null when
 * no connection exists.
 */
async function getInstagramConnection(
  supabase: SupabaseClient,
  businessId: string,
): Promise<ConnectedAccountRow | null> {
  const { data } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("business_id", businessId)
    .eq("platform", "instagram")
    .eq("status", "connected")
    .maybeSingle();

  return (data as ConnectedAccountRow | null) ?? null;
}

function isTokenExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

interface ContainerResponse {
  id?: string;
  error?: { message?: string; type?: string; code?: number };
}

interface PublishResponse {
  id?: string;
  error?: { message?: string; type?: string; code?: number };
}

/**
 * Two-step Instagram Content Publishing API flow:
 *   1. Create media container  (POST /{ig-user-id}/media)
 *   2. Publish the container  (POST /{ig-user-id}/media_publish)
 *
 * @returns the Instagram media id on success.
 */
async function publishToInstagram(
  igUserId: string,
  accessToken: string,
  imageUrl: string,
  caption: string,
): Promise<{ ok: true; instagramPostId: string } | { ok: false; error: string }> {
  const cfg = getMetaAppConfig();
  if (!cfg) return { ok: false, error: "Meta not configured." };

  // Step A — create media container
  const containerUrl = new URL(`${cfg.graphApiBase}/${igUserId}/media`);
  containerUrl.searchParams.set("image_url", imageUrl);
  containerUrl.searchParams.set("caption", caption);
  containerUrl.searchParams.set("access_token", accessToken);

  console.log("[IG-Publish] Step A: creating media container for IG user:", igUserId);

  let containerRes: Response;
  try {
    containerRes = await fetch(containerUrl.toString(), { method: "POST" });
  } catch (e) {
    console.log("[IG-Publish] Step A FETCH ERROR:", e);
    return { ok: false, error: "Could not reach Instagram." };
  }

  let containerJson: ContainerResponse;
  try {
    containerJson = (await containerRes.json()) as ContainerResponse;
  } catch (e) {
    console.log("[IG-Publish] Step A JSON PARSE ERROR:", e);
    return { ok: false, error: "Unexpected response from Instagram." };
  }

  console.log(
    `[IG-Publish] Step A HTTP status=${containerRes.status} has_id=${!!containerJson.id}`,
  );
  if (containerJson.error) {
    console.log("[IG-Publish] Step A error:", JSON.stringify(containerJson.error));
    return { ok: false, error: containerJson.error.message ?? "Media container creation failed." };
  }

  if (!containerJson.id) {
    return { ok: false, error: "Instagram did not return a container ID." };
  }

  // Step B — publish the container
  const publishUrl = new URL(`${cfg.graphApiBase}/${igUserId}/media_publish`);
  publishUrl.searchParams.set("creation_id", containerJson.id);
  publishUrl.searchParams.set("access_token", accessToken);

  console.log("[IG-Publish] Step B: publishing container:", containerJson.id);

  let publishRes: Response;
  try {
    publishRes = await fetch(publishUrl.toString(), { method: "POST" });
  } catch (e) {
    console.log("[IG-Publish] Step B FETCH ERROR:", e);
    return { ok: false, error: "Could not reach Instagram." };
  }

  let publishJson: PublishResponse;
  try {
    publishJson = (await publishRes.json()) as PublishResponse;
  } catch (e) {
    console.log("[IG-Publish] Step B JSON PARSE ERROR:", e);
    return { ok: false, error: "Unexpected response from Instagram." };
  }

  console.log(
    `[IG-Publish] Step B HTTP status=${publishRes.status} has_id=${!!publishJson.id}`,
  );
  if (publishJson.error) {
    console.log("[IG-Publish] Step B error:", JSON.stringify(publishJson.error));
    return { ok: false, error: publishJson.error.message ?? "Publishing failed." };
  }

  if (!publishJson.id) {
    return { ok: false, error: "Instagram did not return a post ID." };
  }

  return { ok: true, instagramPostId: publishJson.id };
}

/**
 * Publish a social post to Instagram via the two-step Content Publishing API.
 *
 * Called by both the direct UI "Publish" button and the approval executor.
 * After a successful publish the social_posts row is updated to status
 * "published" with a real timestamp and the Instagram post ID.
 *
 * On failure the row is updated to "failed" with the honest error reason
 * stored server-side (never exposed raw to the UI — callers translate it).
 *
 * Token lifetime note: Instagram/Facebook long-lived tokens last ~60 days.
 * When a token expires the user must re-connect via Settings → Connect.
 */
export async function publishSocialPost(
  postId: string,
): Promise<PublishResult> {
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
    console.log("[IG-Publish] Post not found or not owned by this business:", postId);
    return { ok: false, error: "not_found" };
  }

  const post = postRow as SocialPostRow;

  if (post.status !== "draft") {
    return { ok: false, error: "not_draft" };
  }

  if (!post.media_url) {
    return { ok: false, error: "no_media" };
  }

  // 2. Read the Instagram connection — verify a connected account exists.
  const connection = await getInstagramConnection(supabase, businessId);
  if (!connection) {
    return { ok: false, error: "no_connection" };
  }

  if (!connection.access_token || !connection.external_account_id) {
    return { ok: false, error: "no_connection" };
  }

  // 3. Check token expiry.
  if (isTokenExpired(connection.token_expires_at)) {
    console.log("[IG-Publish] Token expired for connection:", connection.id);
    return { ok: false, error: "token_expired" };
  }

  // 4. Select the caption for the selected language.
  const caption =
    post.selected_language === "ur"
      ? (post.caption_ur ?? post.caption ?? "")
      : (post.caption_en ?? post.caption ?? "");

  // 5. Two-step Instagram publish.
  const result = await publishToInstagram(
    connection.external_account_id,
    connection.access_token,
    post.media_url,
    caption,
  );

  if (!result.ok) {
    // Update to failed — log the real error server-side only.
    console.error("[IG-Publish] FAILED for post:", postId, "error:", result.error);
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
      console.error("[IG-Publish] DB update to failed also failed:", failUpdateError);
    }
    return { ok: false, error: "publish_failed", detail: result.error };
  }

  // 6. Update to published with the real Instagram post ID.
  //    This is CRITICAL — Marketing Activity reads social_posts.status to
  //    determine Draft vs Published. If this update fails, the approval
  //    action is marked completed but the UI still shows "Draft".
  const now = new Date().toISOString();
  const updatePayload = {
    status: "published",
    published_at: now,
    updated_at: now,
    external_post_reference: result.instagramPostId,
  };

  let { error: updateError } = await supabase
    .from("social_posts")
    .update(updatePayload)
    .eq("id", postId)
    .eq("business_id", businessId);

  // Retry once if the first update failed — the canonical status MUST be
  // persisted for Marketing Activity to show "Published".
  if (updateError) {
    console.error("[IG-Publish] DB update failed after publish, retrying:", updateError);
    const retry = await supabase
      .from("social_posts")
      .update(updatePayload)
      .eq("id", postId)
      .eq("business_id", businessId);
    if (retry.error) {
      // The post IS live on Instagram but our DB status is still "draft".
      // Log as critical — the user will see the post on Instagram but our
      // UI will incorrectly show "Draft". A manual DB fix or re-sync is needed.
      console.error("[IG-Publish] CRITICAL: DB update retry also failed:", retry.error);
    }
    updateError = retry.error;
  }

  console.log("[IG-Publish] SUCCESS — post:", postId, "IG id:", result.instagramPostId);
  return { ok: true, instagramPostId: result.instagramPostId };
}
