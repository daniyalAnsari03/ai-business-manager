import "server-only";

import { NextResponse } from "next/server";

import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/debug/diagnose — diagnostic endpoint for verifying the alignment
 * between the authenticated user's business_id, the products table, and the
 * social_posts table. This is the ground-truth check described in
 * docs/phase0.txt.
 *
 * NEVER expose this in production. It returns raw diagnostic data.
 */
export async function GET(): Promise<Response> {
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const supabase = await getSupabaseServerClient();
  const business = await getUserBusiness();

  if (!business) {
    return NextResponse.json(
      { error: "no_business", userId: user.id },
      { status: 404 },
    );
  }

  // 1. ALL businesses with their product counts (step 2 from phase0.txt)
  const { data: allBusinesses } = await supabase
    .from("businesses")
    .select("id, name, owner_id");

  const businessProductCounts: Array<{
    business_id: string;
    business_name: string;
    owner_id: string;
    product_count: number;
    is_current: boolean;
  }> = [];

  for (const b of allBusinesses ?? []) {
    const { count } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("business_id", b.id);
    businessProductCounts.push({
      business_id: b.id,
      business_name: b.name,
      owner_id: b.owner_id,
      product_count: count ?? 0,
      is_current: b.id === business.id,
    });
  }

  // 2. ALL products for the current business (step 1 from phase0.txt)
  const { data: products } = await supabase
    .from("products")
    .select("id, name, is_active, category, price, created_at")
    .eq("business_id", business.id)
    .order("created_at", { ascending: true });

  // 3. ALL social_posts for the current business (step 4 from phase0.txt)
  const { data: posts } = await supabase
    .from("social_posts")
    .select("id, product_id, platform, status, caption, created_at, products(name)")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false });

  // 4. Build the product-to-draft mapping
  const postByProductId = new Map<string, Array<{
    post_id: string;
    platform: string;
    status: string;
    has_caption: boolean;
  }>>();

  for (const post of posts ?? []) {
    if (post.product_id) {
      const existing = postByProductId.get(post.product_id) ?? [];
      existing.push({
        post_id: post.id,
        platform: post.platform,
        status: post.status,
        has_caption: !!post.caption,
      });
      postByProductId.set(post.product_id, existing);
    }
  }

  const productDraftStatus = (products ?? []).map((p) => {
    const drafts = postByProductId.get(p.id) ?? [];
    return {
      product_id: p.id,
      product_name: p.name,
      is_active: p.is_active,
      category: p.category,
      price: p.price,
      created_at: p.created_at,
      has_draft: drafts.length > 0,
      draft_count: drafts.length,
      drafts: drafts,
    };
  });

  const productsWithoutDrafts = productDraftStatus.filter((p) => !p.has_draft);
  const productsWithDrafts = productDraftStatus.filter((p) => p.has_draft);

  return NextResponse.json({
    ok: true,
    diagnostic: {
      authenticated_user_id: user.id,
      current_business: {
        id: business.id,
        name: business.name,
        owner_id: business.ownerId,
      },
      all_businesses_with_product_counts: businessProductCounts,
      current_business_products: {
        total: products?.length ?? 0,
        active: (products ?? []).filter((p) => p.is_active).length,
        archived: (products ?? []).filter((p) => !p.is_active).length,
        list: productDraftStatus,
      },
      current_business_social_posts: {
        total: posts?.length ?? 0,
        list: (posts ?? []).map((p) => ({
          post_id: p.id,
          product_id: p.product_id,
          product_name:
            (p.products as unknown as { name: string } | null)?.name ?? null,
          platform: p.platform,
          status: p.status,
          has_caption: !!p.caption,
          created_at: p.created_at,
        })),
      },
      alignment_check: {
        products_without_drafts: productsWithoutDrafts.map((p) => ({
          product_id: p.product_id,
          product_name: p.product_name,
        })),
        products_with_drafts: productsWithDrafts.map((p) => ({
          product_id: p.product_id,
          product_name: p.product_name,
          draft_count: p.draft_count,
        })),
        all_products_have_drafts:
          productsWithoutDrafts.length === 0 && productDraftStatus.length > 0,
        mismatch_detected:
          productDraftStatus.length !==
          (products ?? []).filter((p) => p.is_active).length ||
          productsWithoutDrafts.length > 0,
      },
    },
  });
}
