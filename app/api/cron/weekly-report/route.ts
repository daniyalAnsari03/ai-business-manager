import "server-only";

import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { runWeeklyReportForBusiness, type WeeklyReportResult } from "@/lib/marketing/weekly-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/weekly-report
 *
 * Scheduled weekly marketing report delivery. An external scheduler (e.g.
 * Vercel Cron or a cron service) calls this endpoint every week; it iterates
 * every business and delivers that business's real weekly marketing summary by
 * WhatsApp — at most once per (business, ISO week) thanks to the
 * `weekly_report_deliveries` unique constraint. It never uses setInterval()
 * inside the Next.js process.
 *
 * Access control: the endpoint requires the `CRON_SECRET` header set to the
 * value of the `CRON_SECRET`/`CRON_AUTH_TOKEN` env var, so random callers
 * cannot trigger reports.
 */
export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET ?? process.env.CRON_AUTH_TOKEN;
  const provided = request.headers.get("x-cron-secret");
  if (expected && provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = await getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "no_service_role" }, { status: 500 });
  }

  // Compute the current ISO week start (Monday).
  const weekStart = isoWeekStart(new Date());

  const { data: businesses, error: bizError } = await admin
    .from("businesses")
    .select("id, language")
    .order("created_at", { ascending: true });

  if (bizError) {
    return NextResponse.json({ error: "database_error" }, { status: 500 });
  }

  const results: WeeklyReportResult[] = [];
  for (const row of businesses as Array<{ id: string; language: string }>) {
    const language: "en" | "ur" = row.language === "ur" ? "ur" : "en";
    const result = await runWeeklyReportForBusiness(
      { businessId: row.id, weekStart },
      language,
    );
    results.push(result);
  }

  const counts = results.reduce(
    (acc, r) => {
      acc[r.deliveryStatus] = (acc[r.deliveryStatus] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return NextResponse.json({ weekStart, counts, total: results.length });
}

/** Returns the ISO-8601 date (YYYY-MM-DD) of the Monday starting this week. */
function isoWeekStart(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}
