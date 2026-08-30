import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import { generateProductCaption } from "@/lib/ai/caption-generator";
import type { Product } from "@/lib/products/types";
import { isSocialPostPlatform, type SocialPost } from "@/lib/marketing/types";

/**
 * Social posts service layer — the ONLY place that talks to Supabase about
 * `social_posts`. Ownership is always derived from the authenticated
 * server-side session (user -> owned business -> row.business_id); RLS is the
 * second enforcement layer.
 *
 * Phase 2 (reduced, per docs/phase2update.txt): a new product automatically
 * gets a REAL AI-generated caption saved as a "draft" post. There is no real
 * Instagram/Facebook connection yet, so nothing here publishes anywhere — it
 * only drafts. The AI caption text is produced by the SAME OpenAI Agents SDK
 * orchestration used everywhere else in the app (lib/ai/caption-generator.ts),
 * never a separate/parallel call path.
 */

export type SocialPostServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "ai_unavailable"
  | "invalid_input"
  | "database_error";

export type SocialPostServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: SocialPostServiceError };

/** Resolves the caller's session + owned business, or a failure reason. */
async function requireBusinessContext(): Promise<
  { ok: true; supabase: SupabaseClient; business: Business } | { ok: false; reason: SocialPostServiceError }
> {
  let user;
  let supabase: SupabaseClient;
  try {
    user = await getServerUser();
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }
  if (!user) return { ok: false, reason: "unauthenticated" };

  // Ownership always comes from the server session — never client input.
  const business = await getUserBusiness();
  if (!business) return { ok: false, reason: "no_business" };
  return { ok: true, supabase, business };
}

interface SocialPostRow {
  id: string;
  business_id: string;
  product_id: string | null;
  platform: string;
  caption: string | null;
  media_url: string | null;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  products?: { name: string } | null;
}

function isPostStatus(value: string): value is SocialPost["status"] {
  return ["draft", "scheduled", "published", "failed"].includes(value);
}

function mapSocialPost(row: SocialPostRow): SocialPost | null {
  if (!isSocialPostPlatform(row.platform)) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    productId: row.product_id,
    platform: row.platform,
    caption: row.caption,
    mediaUrl: row.media_url,
    status: isPostStatus(row.status) ? row.status : "draft",
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Activity item rendered in the Marketing tab: a social post plus the display
 * name of the product it promotes (joined server-side so the client never
 * needs a second fetch to show "Black Kurta").
 */
export interface ActivityPost extends SocialPost {
  productName: string | null;
}

/** All social_posts for the business, newest first, with product names. */
export async function listSocialPosts(): Promise<
  SocialPostServiceResult<ActivityPost[]>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("social_posts")
    .select("*, products(name)")
    .eq("business_id", context.business.id)
    .order("created_at", { ascending: false });

  if (error) return { ok: false, reason: "database_error" };

  const posts: ActivityPost[] = [];
  for (const row of (data ?? []) as SocialPostRow[]) {
    const mapped = mapSocialPost(row);
    if (mapped) {
      posts.push({
        ...mapped,
        productName: row.products?.name ?? null,
      });
    }
  }
  return { ok: true, data: posts };
}

/**
 * Generates a REAL AI caption for a newly created product and saves it as a
 * `social_posts` draft. This is the "controlled tool -> server-side service
 * -> Supabase -> verified result" boundary: the created draft is re-read from
 * the database and returned only after the insert confirms.
 *
 * Falls back to the created product's business language for the caption. If
 * the AI provider is unavailable the service returns `ai_unavailable` so the
 * caller can decide whether to block the underlying flow.
 */
export async function createDraftForProduct(
  product: Product,
): Promise<SocialPostServiceResult<ActivityPost>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  // Produce the caption through the shared OpenAI Agents SDK orchestration —
  // the SAME model/agent chain the AI Business Manager chat uses.
  const captionResult = await generateProductCaption({
    productName: product.name,
    category: product.category,
    price: product.price,
    currencyCode: context.business.currency,
    imageUrl: product.imageUrl,
    language: context.business.language,
  });
  if (!captionResult.ok) {
    return captionResult.reason === "not_configured"
      ? { ok: false, reason: "not_configured" }
      : { ok: false, reason: "ai_unavailable" };
  }

  const { data, error } = await context.supabase
    .from("social_posts")
    .insert({
      business_id: context.business.id,
      product_id: product.id,
      platform: "instagram",
      caption: captionResult.data.caption,
      media_url: product.imageUrl,
      status: "draft",
    })
    .select("*, products(name)")
    .single();

  if (error) return { ok: false, reason: "database_error" };

  const mapped = mapSocialPost(data as SocialPostRow);
  if (!mapped) return { ok: false, reason: "database_error" };

  return {
    ok: true,
    data: {
      ...mapped,
      productName: (data as SocialPostRow).products?.name ?? null,
    },
  };
}
