import "server-only";

import { NextResponse } from "next/server";

import { generateDailySummary } from "@/lib/ai/daily-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/summary — trigger daily business summary generation.
 *
 * Designed to be called by:
 * - A Vercel Cron Job (with CRON_SECRET in the Authorization header)
 * - Manual testing (same header)
 *
 * For each business with AI Manager configured, generates a concise
 * summary of yesterday's business activity and inserts it as a new
 * conversation in the AI Manager chat.
 *
 * This is a single-business endpoint. For multi-tenant deployment,
 * iterate over all businesses server-side.
 */
export async function POST(request: Request): Promise<Response> {
  // Verify the caller is authorized (Vercel Cron or manual trigger).
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await generateDailySummary();

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    conversationId: result.conversationId,
    message: "Daily summary generated successfully.",
  });
}

/**
 * GET /api/ai/summary — info endpoint explaining how to use the summary API.
 */
export async function GET(): Promise<Response> {
  return NextResponse.json({
    endpoint: "POST /api/ai/summary",
    description:
      "Generates a daily business summary and inserts it as a new conversation in the AI Manager chat.",
    auth: "Requires Authorization: Bearer <CRON_SECRET> header.",
    schedule:
      "Intended to be called once daily via Vercel Cron Job or equivalent scheduler.",
    vercel_cron_example: {
      vercel_json: {
        crons: [
          {
            path: "/api/ai/summary",
            schedule: "0 8 * * *",
          },
        ],
      },
    },
  });
}
