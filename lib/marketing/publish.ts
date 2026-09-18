import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getServerUser,
  getSupabaseServerClient,
  getSupabaseAdminClient,
} from "@/lib/supabase/server";
import { getUserBusiness } from "@/lib/business/service";
import { publishSocialPost } from "@/lib/marketing/instagram-publish";
import { publishFacebookPost } from "@/lib/marketing/facebook-publish";

/**
 * Unified social-post publisher router.
 *
 * The Publish button / approval executor both go through `publishPost`. The
 * router verifies the post exists and belongs to the session's business
 * (ownership-checked via the server session + RLS), then decides the real
 * publish target from the business's connected accounts and dispatches:
 *
 *   Facebook  -> single-step Facebook Page feed/photos API
 *   Instagram -> two-step Instagram Content Publishing API
 *
 * Routing rule (kept simple and honest):
 *   - When a Facebook account is connected for this business, publish to
 *     Facebook (single-step Page API). Facebook is the real, working social
 *     connection in this product today.
 *   - Otherwise, when an Instagram account is connected, publish to Instagram
 *     (two-step Content Publishing API).
 *   - When neither platform is connected, return no_connection.
 *
 * The post's own `platform` field is intentionally NOT used as the routing key:
 * every draft is created as "instagram" by default (legacy), and routing by it
 * would make Facebook publishing unreachable. The connected account is the
 * authoritative signal for where a real post can actually go.
 *
 * This keeps the UI and approval flow platform-agnostic; the router alone
 * decides where the post is published and reports the real platform used.
 */

export type PublishPlatform = "instagram" | "facebook";

export type PublishErrorCode =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "not_found"
  | "not_draft"
  | "no_media"
  | "no_connection"
  | "token_expired"
  | "permission_missing"
  | "container_failed"
  | "publish_failed"
  | "database_error";

export type PublishResult =
  | { ok: true; platform: PublishPlatform; externalPostId: string }
  | { ok: false; platform?: PublishPlatform; error: PublishErrorCode; detail?: string };

type PostAndContext =
  | {
      ok: true;
      supabase: SupabaseClient;
      businessId: string;
    }
  | { ok: false; error: "not_found" | "unauthenticated" | "no_business" | "not_configured" | "database_error" | "not_draft" };

async function readPostAndContext(
  postId: string,
  businessId?: string,
): Promise<PostAndContext> {
  // social_posts.id is a UUID. Reject anything else up front so a malformed
  // post id from an AI/executor cannot surface as a raw database error.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postId)) {
    return { ok: false, error: "not_found" };
  }

  let supabase: SupabaseClient;
  if (businessId) {
    // Session-less path (e.g. webhook-triggered approval execution). The
    // business is already server-verified by the approval engine; ownership is
    // still enforced below by scoping every read/update to this business id.
    supabase = (await getSupabaseAdminClient())!;
    if (!supabase) return { ok: false, error: "not_configured" };
  } else {
    let user;
    try {
      user = await getServerUser();
      supabase = await getSupabaseServerClient();
    } catch {
      return { ok: false, error: "not_configured" };
    }
    if (!user) return { ok: false, error: "unauthenticated" };

    const business = await getUserBusiness();
    if (!business) return { ok: false, error: "no_business" };
    businessId = business.id;
  }

  const { data, error } = await supabase
    .from("social_posts")
    .select("platform, status")
    .eq("id", postId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) return { ok: false, error: "database_error" };
  if (!data) return { ok: false, error: "not_found" };

  return { ok: true, supabase, businessId };
}

function isTokenExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

/**
 * Whether the business has a live (connected + non-expired token) connection
 * for the given platform.
 */
async function hasLiveConnection(
  supabase: SupabaseClient,
  businessId: string,
  platform: PublishPlatform,
): Promise<boolean> {
  const { data } = await supabase
    .from("connected_accounts")
    .select("id, access_token, token_expires_at")
    .eq("business_id", businessId)
    .eq("platform", platform)
    .eq("status", "connected")
    .maybeSingle();

  if (!data) return false;
  if (!data.access_token) return false;
  if (isTokenExpired(data.token_expires_at)) return false;
  return true;
}

/**
 * Decides the publish target. Facebook always wins when connected (it is the
 * real working connection in this product); otherwise Instagram when it is
 * connected. Returns null when nothing is connected.
 */
async function resolveTargetPlatform(
  supabase: SupabaseClient,
  businessId: string,
): Promise<PublishPlatform | null> {
  const fbConnected = await hasLiveConnection(supabase, businessId, "facebook");
  if (fbConnected) return "facebook";
  const igConnected = await hasLiveConnection(supabase, businessId, "instagram");
  if (igConnected) return "instagram";
  return null;
}

/**
 * Publish a drafted social post to the connected platform — Facebook or
 * Instagram. Real publishing only: never fabricates a result. Returns the
 * platform actually used and the real external post id on success.
 */
export async function publishPost(
  postId: string,
  options?: { businessId?: string },
): Promise<PublishResult> {
  const postAndContext = await readPostAndContext(postId, options?.businessId);
  if (!postAndContext.ok) return postAndContext;

  const { supabase, businessId } = postAndContext;

  const target = await resolveTargetPlatform(supabase, businessId);
  if (!target) return { ok: false, error: "no_connection" };

  if (target === "facebook") {
    const result = await publishFacebookPost(postId, { businessId });
    if (!result.ok) return { ...result, platform: "facebook" };
    return {
      ok: true,
      platform: "facebook",
      externalPostId: result.facebookPostId,
    };
  }

  const result = await publishSocialPost(postId, { businessId });
  if (!result.ok) return { ...result, platform: "instagram" };
  return {
    ok: true,
    platform: "instagram",
    externalPostId: result.instagramPostId,
  };
}