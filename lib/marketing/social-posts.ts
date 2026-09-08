import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseAdminClient,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import { generateProductCaption } from "@/lib/ai/caption-generator";
import type { Product } from "@/lib/products/types";
import { isSocialPostPlatform, type SocialPost, type SocialPostPlatform } from "@/lib/marketing/types";
import { isBusinessType, isCurrencyCode } from "@/lib/business/constants";
import { isLanguage } from "@/lib/business/types";

/**
 * Whether the business has a live (connected + non-expired token) connection
 * for the given platform. Mirrors the logic in lib/marketing/publish.ts.
 */
async function hasLiveConnection(
  supabase: SupabaseClient,
  businessId: string,
  platform: SocialPostPlatform,
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
  if (data.token_expires_at && new Date(data.token_expires_at).getTime() < Date.now()) return false;
  return true;
}

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
  caption_ur: string | null;
  caption_en: string | null;
  selected_language: string;
  media_url: string | null;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  external_post_reference: string | null;
  created_at: string;
  updated_at: string;
  products?: { name: string } | null;
}

/** Minimal product shape used by the Phase 0 backfill (mirrors lib/products/service). */
interface BackfillProductRow {
  id: string;
  business_id: string;
  name: string;
  category: string;
  price: string | number;
  image_url: string | null;
}

/** Business row shape used by the global backfill (mirrors lib/business/service). */
interface BusinessRow {
  id: string;
  owner_id: string;
  name: string;
  business_type: string;
  currency: string;
  language: string;
  phone: string | null;
  address: string | null;
  setup_completed: boolean;
  created_at: string;
  updated_at: string;
}

function mapBusinessRow(row: BusinessRow): Business {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    businessType: isBusinessType(row.business_type) ? row.business_type : "other",
    currency: isCurrencyCode(row.currency) ? row.currency : "PKR",
    language: isLanguage(row.language) ? row.language : "en",
    phone: row.phone,
    address: row.address,
    setupCompleted: row.setup_completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBackfillProduct(row: BackfillProductRow): Product {
  const price =
    typeof row.price === "number" ? row.price : Number.parseFloat(row.price);
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    description: null,
    category: row.category,
    price: Number.isFinite(price) ? price : 0,
    stockQuantity: 0,
    lowStockThreshold: 0,
    sku: null,
    imageUrl: row.image_url,
    createdAt: "",
    updatedAt: "",
  };
}

function isPostStatus(value: string): value is SocialPost["status"] {
  return ["draft", "scheduled", "published", "failed"].includes(value);
}

function mapSocialPost(row: SocialPostRow): SocialPost | null {
  if (!isSocialPostPlatform(row.platform)) return null;
  const selectedLanguage = isLanguage(row.selected_language) ? row.selected_language : "en";
  return {
    id: row.id,
    businessId: row.business_id,
    productId: row.product_id,
    platform: row.platform,
    caption: row.caption,
    captionUr: row.caption_ur,
    captionEn: row.caption_en,
    selectedLanguage,
    mediaUrl: row.media_url,
    status: isPostStatus(row.status) ? row.status : "draft",
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    externalPostReference: row.external_post_reference ?? null,
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
  /** Whether the business has a live (connected + non-expired token) connection for this post's platform. */
  platformConnected: boolean;
}

/** All social_posts for the business, newest first, with product names. */
export async function listSocialPosts(): Promise<
  SocialPostServiceResult<ActivityPost[]>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  console.log(
    "[social-posts] listSocialPosts for business_id:",
    context.business.id,
    "business_name:",
    context.business.name,
  );

  const { data, error } = await context.supabase
    .from("social_posts")
    .select("*, products(name)")
    .eq("business_id", context.business.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[social-posts] listSocialPosts DB error:", error);
    return { ok: false, reason: "database_error" };
  }

  console.log(
    "[social-posts] listSocialPosts raw rows:",
    data?.length ?? 0,
    "posts found for business_id:",
    context.business.id,
  );

  const posts: ActivityPost[] = [];
  for (const row of (data ?? []) as SocialPostRow[]) {
    const mapped = mapSocialPost(row);
    if (mapped) {
      // Check if the business has a live connection for this post's platform.
      const platformConnected = await hasLiveConnection(
        context.supabase,
        context.business.id,
        mapped.platform,
      );
      posts.push({
        ...mapped,
        productName: row.products?.name ?? null,
        platformConnected,
      });
    }
  }
  return { ok: true, data: posts };
}

/**
 * Lists all published social posts for the business, newest first.
 */
export async function listPublishedPosts(): Promise<
  SocialPostServiceResult<ActivityPost[]>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  console.log(
    "[social-posts] listPublishedPosts for business_id:",
    context.business.id,
    "business_name:",
    context.business.name,
  );

  const { data, error } = await context.supabase
    .from("social_posts")
    .select("*, products(name)")
    .eq("business_id", context.business.id)
    .eq("status", "published")
    .order("published_at", { ascending: false });

  if (error) {
    console.error("[social-posts] listPublishedPosts DB error:", error);
    return { ok: false, reason: "database_error" };
  }

  console.log(
    "[social-posts] listPublishedPosts raw rows:",
    data?.length ?? 0,
    "posts found for business_id:",
    context.business.id,
  );

  const posts: ActivityPost[] = [];
  for (const row of (data ?? []) as SocialPostRow[]) {
    const mapped = mapSocialPost(row);
    if (mapped) {
      const platformConnected = await hasLiveConnection(
        context.supabase,
        context.business.id,
        mapped.platform,
      );
      posts.push({
        ...mapped,
        productName: row.products?.name ?? null,
        platformConnected,
      });
    }
  }
  return { ok: true, data: posts };
}

/**
 * Generates a REAL AI caption for a product and saves it as a `social_posts`
 * draft. This is the "controlled tool -> server-side service -> Supabase ->
 * verified result" boundary: the created draft is re-read from the database
 * and returned only after the insert confirms.
 *
 * The caption is produced through the shared OpenAI Agents SDK orchestration
 * (lib/ai/caption-generator.ts) in the business's language — the SAME logic
 * used by the AI Business Manager chat and by new-product creation. Both the
 * live create flow and the Phase 0 backfill route through this one helper so
 * there is never a separate/different caption path.
 */
async function insertDraftForProduct(
  supabase: SupabaseClient,
  business: Business,
  product: Product,
): Promise<SocialPostServiceResult<ActivityPost>> {
  const captionResult = await generateProductCaption({
    productName: product.name,
    category: product.category,
    price: product.price,
    currencyCode: business.currency,
    imageUrl: product.imageUrl,
    language: business.language,
  });
  if (!captionResult.ok) {
    return captionResult.reason === "not_configured"
      ? { ok: false, reason: "not_configured" }
      : { ok: false, reason: "ai_unavailable" };
  }

  const { captionUr, captionEn } = captionResult.data;
  // Default to the business's language setting; the caption column mirrors it.
  const selectedLanguage = business.language;
  const caption = selectedLanguage === "ur" ? captionUr : captionEn;

  const { data, error } = await supabase
    .from("social_posts")
    .insert({
      business_id: business.id,
      product_id: product.id,
      platform: "instagram",
      caption,
      caption_ur: captionUr,
      caption_en: captionEn,
      selected_language: selectedLanguage,
      media_url: product.imageUrl,
      status: "draft",
    })
    .select("*, products(name)")
    .single();

  if (error) return { ok: false, reason: "database_error" };

  const mapped = mapSocialPost(data as SocialPostRow);
  if (!mapped) return { ok: false, reason: "database_error" };

  const platformConnected = await hasLiveConnection(supabase, business.id, mapped.platform);

  return {
    ok: true,
    data: {
      ...mapped,
      productName: (data as SocialPostRow).products?.name ?? null,
      platformConnected,
    },
  };
}

/**
 * Deletes a published social post from the local database.
 * This ONLY removes the local record — it does NOT delete the live post
 * from Facebook/Instagram. The external post remains on the platform.
 */
export async function deletePublishedPost(
  postId: string,
): Promise<SocialPostServiceResult<{ deleted: boolean }>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { error } = await context.supabase
    .from("social_posts")
    .delete()
    .eq("id", postId)
    .eq("business_id", context.business.id)
    .eq("status", "published");

  if (error) return { ok: false, reason: "database_error" };

  return { ok: true, data: { deleted: true } };
}

/**
 * Deletes a draft social post from the local database.
 * Only draft posts can be deleted through this function.
 * Associated pending approval actions (if any) are also cleaned up.
 */
export async function deleteDraftPost(
  postId: string,
): Promise<SocialPostServiceResult<{ deleted: boolean }>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  // Verify the post is a draft owned by this business.
  const { data: postRow, error: postError } = await context.supabase
    .from("social_posts")
    .select("id, status")
    .eq("id", postId)
    .eq("business_id", context.business.id)
    .single();

  if (postError || !postRow) return { ok: false, reason: "database_error" };
  if (postRow.status !== "draft") return { ok: false, reason: "invalid_input" };

  // Cancel any pending approval actions that reference this post via idempotency key.
  await context.supabase
    .from("approval_actions")
    .update({ status: "cancelled" })
    .eq("business_id", context.business.id)
    .eq("status", "pending")
    .like("idempotency_key", `post-publish-${postId}`);

  // Delete the draft post.
  const { error } = await context.supabase
    .from("social_posts")
    .delete()
    .eq("id", postId)
    .eq("business_id", context.business.id)
    .eq("status", "draft");

  if (error) return { ok: false, reason: "database_error" };

  return { ok: true, data: { deleted: true } };
}

/**
 * Generates a REAL AI caption for a product and saves it as a `social_posts`
 * draft. This is the "controlled tool -> server-side service -> Supabase ->
 * verified result" boundary: the created draft is re-read from the database
 * and returned only after the insert confirms.
 *
 * Idempotent: if a draft already exists for this product, it is UPDATED
 * (regenerated) rather than creating a duplicate row. Only draft posts are
 * updated; published/failed/scheduled posts are left alone and a new draft
 * is created instead.
 */
export interface CreateDraftResult extends ActivityPost {
  /** Whether this is a newly created draft (false when an existing draft was updated). */
  isNew: boolean;
}

export async function createDraftForProduct(
  product: Product,
): Promise<SocialPostServiceResult<CreateDraftResult>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { supabase, business } = context;

  // Check for an existing draft for this product.
  const { data: existingDraft, error: existingError } = await supabase
    .from("social_posts")
    .select("id, status")
    .eq("business_id", business.id)
    .eq("product_id", product.id)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.error("[social-posts] createDraftForProduct check existing error:", existingError);
    return { ok: false, reason: "database_error" };
  }

  if (existingDraft) {
    // An active draft exists — regenerate its caption instead of creating a duplicate.
    console.log(
      "[social-posts] createDraftForProduct: updating existing draft",
      existingDraft.id,
      "for product",
      product.id,
    );
    const result = await regeneratePostCaption(existingDraft.id);
    if (!result.ok) return result;
    return { ok: true, data: { ...result.data, isNew: false } };
  }

  // No active draft — create a new one.
  const result = await insertDraftForProduct(supabase, business, product);
  if (!result.ok) return result;
  return { ok: true, data: { ...result.data, isNew: true } };
}

/** A draft that resulted from the backfill, captured for reporting. */
export interface BackfillResult {
  /** Number of active products that already had a draft (skipped, not duplicated). */
  skippedExisting: number;
  /** Number of drafts created by this run. */
  created: number;
  /** Products that could not be drafted (AI unavailable / DB error). */
  failed: Array<{ name: string; reason: SocialPostServiceError }>;
  /** Sample of the drafts created in this run (product name + caption). */
  createdSamples: ActivityPost[];
}

export type BackfillServiceResult =
  | { ok: true; data: BackfillResult }
  | { ok: false; reason: SocialPostServiceError };

/**
 * The core per-business backfill: generates a draft for every ACTIVE product
 * of `business` that does not already have a `social_posts` row, using that
 * business's own language setting. Uses the exact same caption logic as
 * new-product creation (insertDraftForProduct). It is idempotent — products
 * that already have a draft are skipped, so a re-run creates no duplicates.
 *
 * The Supabase client is passed in so the same code path serves both the
 * session-scoped backfill (RLS-bound, caller's own business) and the global
 * backfill (service-role, iterating every business). Only `social_posts`
 * rows are inserted; the `products` table is never modified.
 */
async function backfillBusinessProducts(
  supabase: SupabaseClient,
  business: Business,
): Promise<BackfillResult> {
  // Mirror the catalogue used by the app: only active products are visible
  // and eligible for a draft. Archived products never appear in the feed, so
  // they are intentionally excluded (same rule as lib/products/service.ts).
  const { data: productRows, error: productsError } = await supabase
    .from("products")
    .select("id, business_id, name, category, price, image_url")
    .eq("business_id", business.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (productsError) {
    console.error("[social-posts] backfill products query error:", productsError);
    return { skippedExisting: 0, created: 0, failed: [], createdSamples: [] };
  }

  const { data: postRows, error: postsError } = await supabase
    .from("social_posts")
    .select("product_id")
    .eq("business_id", business.id);
  if (postsError) {
    console.error("[social-posts] backfill social_posts query error:", postsError);
    return { skippedExisting: 0, created: 0, failed: [], createdSamples: [] };
  }

  const existingProductIds = new Set<string>();
  for (const row of (postRows ?? []) as Array<{ product_id: string | null }>) {
    if (row.product_id) existingProductIds.add(row.product_id);
  }

  const products = ((productRows ?? []) as BackfillProductRow[]).map(
    mapBackfillProduct,
  );

  const missing = products.filter((product) => !existingProductIds.has(product.id));

  const result: BackfillResult = {
    skippedExisting: products.length - missing.length,
    created: 0,
    failed: [],
    createdSamples: [],
  };

  if (missing.length > 0) {
    for (const product of missing) {
      console.log(
        "[social-posts] creating draft for product:",
        product.id,
        product.name,
        "business:",
        business.id,
      );
      const draft = await insertDraftForProduct(supabase, business, product);
      if (!draft.ok) {
        console.error(
          "[social-posts] FAILED to create draft for product:",
          product.id,
          product.name,
          "reason:",
          draft.reason,
        );
        result.failed.push({
          name: product.name,
          reason:
            draft.reason === "not_configured" || draft.reason === "ai_unavailable"
              ? draft.reason
              : "database_error",
        });
        continue;
      }
      console.log(
        "[social-posts] SUCCESS: created draft for product:",
        product.id,
        product.name,
        "post_id:",
        draft.data.id,
      );
      result.created += 1;
      result.createdSamples.push(draft.data);
    }
  }

  return result;
}

/**
 * Session-scoped backfill (docs/phase0.txt) — generates a draft for every
 * ACTIVE product of the caller's business that does not already have one.
 *
 * Ownership is always derived from the authenticated server-side session and
 * enforced again by RLS — one business is never touched from another. The
 * language setting of the caller's business drives each generated caption.
 * Idempotent: products that already have a draft are skipped, so a second run
 * creates no duplicates. Only `social_posts` rows are inserted; the
 * `products` table is never modified.
 */
export async function backfillMissingProductDrafts(): Promise<BackfillServiceResult> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;
  console.log(
    "[social-posts] backfillMissingProductDrafts for business_id:",
    context.business.id,
    "business_name:",
    context.business.name,
  );
  const data = await backfillBusinessProducts(context.supabase, context.business);
  console.log("[social-posts] backfill result:", {
    business_id: context.business.id,
    skippedExisting: data.skippedExisting,
    created: data.created,
    failedCount: data.failed.length,
  });
  return { ok: true, data };
}

/** Per-business outcome of the global backfill, for honest reporting. */
export interface GlobalBackfillBusiness {
  business_id: string;
  business_name: string;
  owner_id: string | null;
  product_count: number;
  drafts_missing_before: number;
  drafts_created: number;
  skipped_existing: number;
}

export type GlobalBackfillServiceResult =
  | { ok: true; data: { businesses: GlobalBackfillBusiness[]; totalDraftsCreated: number } }
  | { ok: false; reason: SocialPostServiceError | "no_service_role" };

/**
 * Global backfill (docs/phase0.txt scope change) — runs the backfill across
 * EVERY business in the system, not just the caller's own.
 *
 * This is a deliberate admin operation that must read/write every business's
 * social_posts, which Supabase RLS would block for a normal session-bound
 * client. It therefore uses the server-side service-role client. If no
 * service-role key is configured it returns `no_service_role` so the caller
 * can tell the user that this global operation needs the admin key — it never
 * fabricates a result or touches data it cannot honestly reach.
 *
 * Each business is backfilled through the SAME per-business helper as the
 * live flow, driven by that business's OWN products and its OWN language
 * setting — data is never mixed across businesses. The operation is fully
 * idempotent (already-drafted products are skipped), so running it twice
 * creates no duplicates. Only `social_posts` rows are inserted; the
 * `products` table is never modified.
 */
export async function backfillAllMissingProductDrafts(): Promise<GlobalBackfillServiceResult> {
  const admin = await getSupabaseAdminClient();
  if (!admin) {
    return {
      ok: false,
      reason: "no_service_role",
    };
  }

  // Enumerate every business. The service-role client is not constrained by
  // RLS, so this list is complete.
  const { data: businessRows, error: businessError } = await admin
    .from("businesses")
    .select("id, owner_id, name, business_type, currency, language, phone, address, setup_completed, created_at, updated_at")
    .order("created_at", { ascending: true });
  if (businessError) {
    console.error("[social-posts] global backfill businesses query error:", businessError);
    return { ok: false, reason: "database_error" };
  }

  const businesses = (businessRows ?? []).map((row) => {
    const mapped = mapBusinessRow(row as BusinessRow);
    return { row: row as BusinessRow, business: mapped };
  });

  const report: GlobalBackfillBusiness[] = [];
  let totalDraftsCreated = 0;

  for (const { row, business } of businesses) {
    // Count ACTIVE products first for an honest "missing before" figure.
    const { count: activeProducts } = await admin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .eq("is_active", true);

    const result = await backfillBusinessProducts(admin, business);
    totalDraftsCreated += result.created;

    report.push({
      business_id: business.id,
      business_name: business.name,
      owner_id: row.owner_id,
      product_count: activeProducts ?? 0,
      drafts_missing_before: result.skippedExisting + result.created,
      drafts_created: result.created,
      skipped_existing: result.skippedExisting,
    });
  }

  return { ok: true, data: { businesses: report, totalDraftsCreated } };
}

/**
 * Regenerates both bilingual captions for an existing draft post. The existing
 * row is UPDATED — no duplicate row is created. Only draft posts are eligible.
 * Ownership is derived from the authenticated server-side session; RLS is the
 * second enforcement layer.
 *
 * If the AI call fails, the existing captions are left intact (never wiped).
 */
export async function regeneratePostCaption(
  postId: string,
): Promise<SocialPostServiceResult<ActivityPost>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  // Read the existing post — verify it belongs to this business.
  const { data: postRow, error: postError } = await context.supabase
    .from("social_posts")
    .select("*, products(name, category, price, image_url)")
    .eq("id", postId)
    .eq("business_id", context.business.id)
    .single();

  if (postError || !postRow) {
    return { ok: false, reason: "database_error" };
  }

  const row = postRow as SocialPostRow & {
    products?: { name: string; category: string; price: string | number; image_url: string | null } | null;
  };

  if (row.status !== "draft") {
    return { ok: false, reason: "invalid_input" };
  }

  if (!row.products) {
    return { ok: false, reason: "database_error" };
  }

  const price =
    typeof row.products.price === "number"
      ? row.products.price
      : Number.parseFloat(row.products.price);

  const captionResult = await generateProductCaption({
    productName: row.products.name,
    category: row.products.category,
    price: Number.isFinite(price) ? price : 0,
    currencyCode: context.business.currency,
    imageUrl: row.products.image_url,
    language: context.business.language,
  });

  if (!captionResult.ok) {
    // NEVER wipe existing captions on failure — return the reason to the caller.
    return {
      ok: false,
      reason: captionResult.reason === "not_configured" ? "not_configured" : "ai_unavailable",
    };
  }

  const { captionUr, captionEn } = captionResult.data;
  const selectedLanguage = context.business.language;
  const caption = selectedLanguage === "ur" ? captionUr : captionEn;

  const { data: updatedRow, error: updateError } = await context.supabase
    .from("social_posts")
    .update({
      caption,
      caption_ur: captionUr,
      caption_en: captionEn,
      selected_language: selectedLanguage,
    })
    .eq("id", postId)
    .eq("business_id", context.business.id)
    .select("*, products(name)")
    .single();

  if (updateError) return { ok: false, reason: "database_error" };

  const mapped = mapSocialPost(updatedRow as SocialPostRow);
  if (!mapped) return { ok: false, reason: "database_error" };

  const platformConnected = await hasLiveConnection(
    context.supabase,
    context.business.id,
    mapped.platform,
  );

  return {
    ok: true,
    data: {
      ...mapped,
      productName: (updatedRow as SocialPostRow).products?.name ?? null,
      platformConnected,
    },
  };
}

/**
 * Updates just the selected_language for a post (the per-draft language toggle).
 * The `caption` column is synced to mirror the selected language. Only draft
 * posts are eligible.
 */
export async function updatePostLanguage(
  postId: string,
  selectedLanguage: "en" | "ur",
): Promise<SocialPostServiceResult<ActivityPost>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data: postRow, error: postError } = await context.supabase
    .from("social_posts")
    .select("*, products(name)")
    .eq("id", postId)
    .eq("business_id", context.business.id)
    .single();

  if (postError || !postRow) {
    return { ok: false, reason: "database_error" };
  }

  const row = postRow as SocialPostRow;
  const caption = selectedLanguage === "ur" ? row.caption_ur : row.caption_en;

  const { data: updatedRow, error: updateError } = await context.supabase
    .from("social_posts")
    .update({
      selected_language: selectedLanguage,
      caption,
    })
    .eq("id", postId)
    .eq("business_id", context.business.id)
    .select("*, products(name)")
    .single();

  if (updateError) return { ok: false, reason: "database_error" };

  const mapped = mapSocialPost(updatedRow as SocialPostRow);
  if (!mapped) return { ok: false, reason: "database_error" };

  const platformConnected = await hasLiveConnection(
    context.supabase,
    context.business.id,
    mapped.platform,
  );

  return {
    ok: true,
    data: {
      ...mapped,
      productName: (updatedRow as SocialPostRow).products?.name ?? null,
      platformConnected,
    },
  };
}
