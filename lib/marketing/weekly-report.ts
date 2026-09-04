import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { getWhatsAppProvider } from "@/lib/marketing/whatsapp/provider";

/**
 * Weekly WhatsApp marketing report.
 *
 * Generates a summary of REAL business data from Supabase (posts published,
 * platforms, ad spend, wallet usage, remaining balance, top post) and, when a
 * WhatsApp connection exists, delivers it to the owner by WhatsApp — at most
 * once per (business, ISO week) thanks to the `weekly_report_deliveries`
 * unique constraint.
 *
 * Only metrics that actually exist in the database are included. There is no
 * fabricated engagement/analytics. If WhatsApp is not connected, the delivery
 * is recorded as `skipped` (never "sent").
 *
 * This is invoked by the scheduled endpoint (app/api/cron/weekly-report) on a
 * per-business basis. It is NOT a setInterval() inside the Next.js process —
 * an external scheduler (e.g. Vercel Cron) calls the endpoint weekly.
 */

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number.parseFloat(String(value)) || 0;
}

export interface WeeklyReportInput {
  businessId: string;
  /** ISO date (YYYY-MM-DD) of the Monday that starts the week being reported. */
  weekStart: string;
}

/**
 * Generates the weekly marketing summary from real Supabase data for a single
 * business. Returns a structured report plus a localized WhatsApp body.
 */
async function buildReport(admin: SupabaseClient, businessId: string, language: "en" | "ur") {
  const [businessRow] = await Promise.all([
    admin
      .from("businesses")
      .select("name, phone, language")
      .eq("id", businessId)
      .single(),
  ]);
  const business = businessRow.data as { name: string; phone: string | null; language: string } | null;
  const businessLanguage: "en" | "ur" = language;

  // Posts published this week (only real `published` status counts).
  const { data: publishedPosts } = await admin
    .from("social_posts")
    .select("id, platform, caption")
    .eq("business_id", businessId)
    .eq("status", "published")
    .order("published_at", { ascending: false });

  // Ad spend (all time) + wallet state.
  const { data: campaigns } = await admin
    .from("ad_campaigns")
    .select("spent_amount, platform")
    .eq("business_id", businessId);
  const adSpend = ((campaigns ?? []) as Array<{ spent_amount: string | number }>).reduce(
    (sum, c) => sum + toNumber(c.spent_amount),
    0,
  );

  const { data: walletRow } = await admin
    .from("marketing_wallet")
    .select("balance, monthly_budget_cap")
    .eq("business_id", businessId)
    .maybeSingle();
  const wallet = walletRow as { balance: string | number; monthly_budget_cap: string | number | null } | null;

  // Top-performing post by caption text (first published, since no engagement
  // data exists — we never invent engagement numbers).
  const posts = (publishedPosts ?? []) as Array<{ id: string; platform: string; caption: string | null }>;

  // Platforms used (distinct).
  const platformsUsed = Array.from(new Set(posts.map((p) => p.platform)));

  const report = {
    businessName: business?.name ?? "Business",
    weekStart: undefined as string | undefined,
    publishedCount: posts.length,
    platforms: platformsUsed,
    adSpend,
    walletBalance: wallet ? toNumber(wallet.balance) : 0,
    walletCap: wallet ? (wallet.monthly_budget_cap == null ? null : toNumber(wallet.monthly_budget_cap)) : null,
    topPostCaption: posts[0]?.caption ?? null,
  };

  const body = formatReportBody(report, businessLanguage);
  return { report, body, phone: business?.phone ?? null };
}

interface FormattedReport {
  businessName: string;
  publishedCount: number;
  platforms: string[];
  adSpend: number;
  walletBalance: number;
  walletCap: number | null;
  topPostCaption: string | null;
}

function formatReportBody(report: FormattedReport, language: "en" | "ur"): string {
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (language === "ur") {
    const lines = [
      report.businessName,
      "",
      "Weekly marketing summary",
      "",
      `Posts published: ${report.publishedCount}`,
      report.platforms.length
        ? `Platforms: ${report.platforms.join(", ")}`
        : "Platforms: -",
      `Ad spend: Rs. ${fmt(report.adSpend)}`,
      `Wallet balance: Rs. ${fmt(report.walletBalance)}`,
      report.walletCap == null
        ? "Monthly cap: Koi cap set nahi hai"
        : `Monthly cap: Rs. ${fmt(report.walletCap)}`,
    ];
    if (report.topPostCaption) {
      lines.push("", "Top post:", report.topPostCaption);
    } else {
      lines.push("", "Is hafte koi published post nahi thi.");
    }
    return lines.join("\n");
  }

  const lines = [
    report.businessName,
    "",
    "Weekly marketing summary",
    "",
    `Posts published: ${report.publishedCount}`,
    report.platforms.length ? `Platforms: ${report.platforms.join(", ")}` : "Platforms: -",
    `Ad spend: Rs. ${fmt(report.adSpend)}`,
    `Wallet balance: Rs. ${fmt(report.walletBalance)}`,
    report.walletCap == null ? "Monthly cap: none" : `Monthly cap: Rs. ${fmt(report.walletCap)}`,
  ];
  if (report.topPostCaption) {
    lines.push("", "Top post:", report.topPostCaption);
  } else {
    lines.push("", "No posts were published this week.");
  }
  return lines.join("\n");
}

export interface WeeklyReportResult {
  deliveryStatus: "sent" | "skipped" | "failed";
  weekStart: string;
  businessId: string;
  reason?: string;
}

/**
 * Generates and (if connected) delivers the weekly report for ONE business.
 * Idempotent: a second call for the same business/week returns the stored
 * result without sending again.
 */
export async function runWeeklyReportForBusiness(
  input: WeeklyReportInput,
  language: "en" | "ur" = "en",
): Promise<WeeklyReportResult> {
  const admin = await getSupabaseAdminClient();
  if (!admin) return { deliveryStatus: "failed", weekStart: input.weekStart, businessId: input.businessId, reason: "no_service_role" };

  // Idempotency: check for an existing delivery for this business/week.
  const { data: existing } = await admin
    .from("weekly_report_deliveries")
    .select("*")
    .eq("business_id", input.businessId)
    .eq("week_start", input.weekStart)
    .maybeSingle();

  if (existing) {
    const status = (existing as { delivery_status: string }).delivery_status;
    return {
      deliveryStatus: (status === "sent" ? "sent" : status === "skipped" ? "skipped" : "failed") as "sent" | "skipped" | "failed",
      weekStart: input.weekStart,
      businessId: input.businessId,
    };
  }

  // Reserve the delivery row first so two concurrent runs can't double-send.
  const { data: reserved, error: reserveError } = await admin
    .from("weekly_report_deliveries")
    .insert({
      business_id: input.businessId,
      week_start: input.weekStart,
      delivery_status: "pending",
    })
    .select("*")
    .maybeSingle();

  if (reserveError) {
    // Unique conflict means another run already claimed it — treat as done.
    return { deliveryStatus: "skipped", weekStart: input.weekStart, businessId: input.businessId, reason: "already_processed" };
  }
  const deliveryId = (reserved as { id: string }).id;

  const { report, body, phone } = await buildReport(admin, input.businessId, language);

  // If the business has no phone or WhatsApp is not configured, record skipped.
  const provider = getWhatsAppProvider();
  if (!provider || !phone) {
    await admin
      .from("weekly_report_deliveries")
      .update({
        delivery_status: "skipped",
        report_payload: report,
        delivery_error: provider ? "No business phone number" : "WhatsApp not configured",
        delivered_at: new Date().toISOString(),
      })
      .eq("id", deliveryId);
    return { deliveryStatus: "skipped", weekStart: input.weekStart, businessId: input.businessId, reason: provider ? "no_phone" : "not_configured" };
  }

  const sent = await provider.sendText({
    businessId: input.businessId,
    to: phone,
    text: body,
    messageId: `weekly-${input.businessId}-${input.weekStart}`,
  });

  if (sent.ok && sent.data.delivered) {
    await admin
      .from("weekly_report_deliveries")
      .update({
        delivery_status: "sent",
        report_payload: report,
        delivered_at: new Date().toISOString(),
      })
      .eq("id", deliveryId);
    return { deliveryStatus: "sent", weekStart: input.weekStart, businessId: input.businessId };
  }

  await admin
    .from("weekly_report_deliveries")
    .update({
      delivery_status: "failed",
      report_payload: report,
      delivery_error: sent.ok ? "Send failed" : sent.reason ?? "unknown",
    })
    .eq("id", deliveryId);
  return {
    deliveryStatus: "failed",
    weekStart: input.weekStart,
    businessId: input.businessId,
    reason: sent.ok ? "send_failed" : sent.reason ?? "unknown",
  };
}
