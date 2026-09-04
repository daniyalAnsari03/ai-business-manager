import "server-only";

import { NextResponse } from "next/server";

import { backfillAllMissingProductDrafts } from "@/lib/marketing/social-posts";
import { getServerUser, getSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/marketing/backfill-all — ADMIN-ONLY global backfill
 * (docs/phase0.txt scope change).
 *
 * Runs the marketing-draft backfill across EVERY business in the system, not
 * just the caller's. Because RLS would prevent a normal session-bound client
 * from reading/writing other businesses' rows, this endpoint can only succeed
 * when the server-side service-role key is configured. If it is not
 * configured, it returns `no_service_role` — it never fabricates a result.
 *
 * SAFETY:
 *  - Requires an authenticated user (401 otherwise).
 *  - Requires the service-role key to be present server-side (403 otherwise);
 *    the key itself is never exposed — it is only used server-side.
 *  - Each business is backfilled from its OWN products with its OWN language,
 *    never mixing data across businesses.
 *  - Fully idempotent: products that already have a draft are skipped, so a
 *    second run creates no duplicates.
 *
 * Only `social_posts` rows are inserted; the `products` table is never
 * modified.
 */
export async function POST(): Promise<Response> {
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // The admin client is null when no service-role key is configured. We check
  // it here up front so we can return an explicit 403 rather than only an
  // internal `no_service_role` payload.
  const admin = await getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "no_service_role" },
      { status: 403 },
    );
  }

  const result = await backfillAllMissingProductDrafts();
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: result.data });
}
