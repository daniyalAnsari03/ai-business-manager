import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import {
  isMarketingPlatform,
  type ConnectedAccount,
  type ConnectedAccountStatus,
  type MarketingMetrics,
  type MarketingWallet,
} from "@/lib/marketing/types";

/**
 * Marketing service layer — the ONLY place that talks to Supabase about the
 * marketing module. Ownership is always derived from the authenticated
 * server-side session (user -> owned business -> row.business_id); RLS is
 * the second enforcement layer. Phase 1 exposes read paths for the existing
 * tables plus the single writable field (monthly budget cap). Posts, ads,
 * payments and automation unlock in later phases and will reuse these same
 * helpers.
 */

export type MarketingServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "database_error";

export type MarketingServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: MarketingServiceError };

/** Resolves the caller's session + owned business, or a failure reason. */
async function requireBusinessContext(): Promise<
  { ok: true; supabase: SupabaseClient; business: Business } | { ok: false; reason: MarketingServiceError }
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

function toNumber(value: string | number | null): number {
  if (value === null) return 0;
  return typeof value === "number" ? value : Number.parseFloat(value) || 0;
}

interface WalletRow {
  id: string;
  business_id: string;
  balance: string | number;
  monthly_budget_cap: string | number | null;
  created_at: string;
  updated_at: string;
}

function mapWallet(row: WalletRow): MarketingWallet {
  return {
    id: row.id,
    businessId: row.business_id,
    balance: toNumber(row.balance),
    monthlyBudgetCap:
      row.monthly_budget_cap === null ? null : toNumber(row.monthly_budget_cap),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ConnectedAccountRow {
  id: string;
  business_id: string;
  platform: string;
  status: string;
  account_label: string | null;
  created_at: string;
  updated_at: string;
}

function mapConnectedAccount(row: ConnectedAccountRow): ConnectedAccount | null {
  if (!isMarketingPlatform(row.platform)) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    platform: row.platform,
    status: (row.status === "connected"
      ? "connected"
      : "not_connected") as ConnectedAccountStatus,
    accountLabel: row.account_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Weeks start on Monday, matching lib/sales/service.ts. */
function startOfWeek(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return date;
}

/**
 * Real phase-1 metrics for the Marketing tab. Reads directly from the new
 * tables; with no activity every value is 0 — that is correct and expected.
 */
export async function getMarketingMetrics(): Promise<
  MarketingServiceResult<MarketingMetrics>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const weekStartIso = startOfWeek().toISOString();

  const [postsResult, spendResult] = await Promise.all([
    context.supabase
      .from("social_posts")
      .select("id", { count: "exact", head: true })
      .eq("business_id", context.business.id)
      .gte("created_at", weekStartIso),
    context.supabase
      .from("ad_campaigns")
      .select("spent_amount")
      .eq("business_id", context.business.id),
  ]);

  if (postsResult.error || spendResult.error) {
    return { ok: false, reason: "database_error" };
  }

  const adSpend = ((spendResult.data ?? []) as Array<{
    spent_amount: string | number;
  }>).reduce((sum, row) => sum + toNumber(row.spent_amount), 0);

  return {
    ok: true,
    data: {
      // No attribution source exists yet, so this stays honestly at 0.
      salesFromAds: 0,
      postsThisWeek: postsResult.count ?? 0,
      adSpend,
    },
  };
}

/**
 * The caller's marketing wallet row. Returns null when no wallet has been
 * created yet (Phase 1 never force-creates one on read; saving the budget
 * cap is what materialises the row).
 */
export async function getMarketingWallet(): Promise<
  MarketingServiceResult<MarketingWallet | null>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("marketing_wallet")
    .select("*")
    .eq("business_id", context.business.id)
    .maybeSingle();

  if (error) return { ok: false, reason: "database_error" };
  return { ok: true, data: data ? mapWallet(data as WalletRow) : null };
}

const BUDGET_CAP_MAX = 1_000_000_000;

/**
 * Saves the monthly ad budget cap. A blank/zero input clears the cap back to
 * "none". The wallet row is upserted on business_id so the widget works even
 * before any other marketing activity exists. Pure number persistence — no
 * payment logic in this phase.
 */
export async function updateMarketingBudgetCap(
  input: unknown,
): Promise<MarketingServiceResult<{ monthlyBudgetCap: number | null }>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  // Accept a number, an empty string (clear), or null (clear).
  let cap: number | null = null;
  if (typeof input === "number" && Number.isFinite(input)) {
    cap = input;
  } else if (typeof input === "string" && input.trim() !== "") {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return { ok: false, reason: "invalid_input" };
    cap = parsed;
  }

  if (cap !== null && (cap < 0 || cap > BUDGET_CAP_MAX)) {
    return { ok: false, reason: "invalid_input" };
  }

  const { data, error } = await context.supabase
    .from("marketing_wallet")
    .upsert(
      {
        business_id: context.business.id,
        monthly_budget_cap: cap === null ? null : Math.round(cap * 100) / 100,
      },
      { onConflict: "business_id" },
    )
    .select("monthly_budget_cap, business_id")
    .single();

  if (error || !data) return { ok: false, reason: "database_error" };

  return {
    ok: true,
    data: {
      monthlyBudgetCap:
        data.monthly_budget_cap === null
          ? null
          : toNumber(data.monthly_budget_cap),
    },
  };
}

/**
 * Currently stored connected accounts for this business (rows that exist in
 * the table). The Settings shell merges these over the four known platforms
 * so a missing row honestly renders as "not connected".
 */
export async function getConnectedAccounts(): Promise<
  MarketingServiceResult<ConnectedAccount[]>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("connected_accounts")
    .select("*")
    .eq("business_id", context.business.id);

  if (error) return { ok: false, reason: "database_error" };

  const accounts = ((data ?? []) as ConnectedAccountRow[])
    .map(mapConnectedAccount)
    .filter((account): account is ConnectedAccount => account !== null);

  return { ok: true, data: accounts };
}