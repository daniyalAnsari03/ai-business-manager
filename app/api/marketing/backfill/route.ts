import "server-only";

import { NextResponse } from "next/server";

import { backfillMissingProductDrafts } from "@/lib/marketing/social-posts";
import { getServerUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/marketing/backfill — one-time, on-demand backfill for products
 * that predate automatic captions (docs/phase0.txt).
 *
 * This is deliberately NOT a recurring/background job: it only runs when an
 * authenticated owner calls it, and it is idempotent (products that already
 * have a `social_posts` draft are skipped). Ownership, per-business language
 * and RLS are all enforced inside the service; the caller can only ever
 * backfill their own business's products. The `products` table is never
 * modified — only `social_posts` inserts happen.
 */
export async function POST(): Promise<Response> {
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const result = await backfillMissingProductDrafts();
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: result.data });
}
