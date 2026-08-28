import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import { getServerUser, getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sales service layer — real revenue derived ONLY from completed orders.
 * No fake analytics, no random numbers: every figure is summed from actual
 * business rows. Future AI tools can reuse getSalesSummary directly.
 */

export interface SalesPeriodStats {
  /** Sum of completed order totals inside the period. */
  revenue: number;
  /** Number of completed orders inside the period. */
  orderCount: number;
}

export interface SalesSummary {
  today: SalesPeriodStats;
  yesterday: SalesPeriodStats;
  week: SalesPeriodStats;
  lastWeek: SalesPeriodStats;
  month: SalesPeriodStats;
  lastMonth: SalesPeriodStats;
  allTime: SalesPeriodStats;
}

export interface SaleEntry {
  id: string;
  orderNumber: string;
  customerName: string | null;
  total: number;
  orderedAt: string;
}

export type SalesServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "database_error";

export type SalesServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: SalesServiceError };

async function requireBusinessContext(): Promise<
  { ok: true; supabase: SupabaseClient; business: Business } | { ok: false; reason: SalesServiceError }
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

  const business = await getUserBusiness();
  if (!business) return { ok: false, reason: "no_business" };
  return { ok: true, supabase, business };
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfWeek(): Date {
  const date = startOfToday();
  // Weeks start on Monday.
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return date;
}

function startOfMonth(): Date {
  const date = startOfToday();
  date.setDate(1);
  return date;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseFloat(value) || 0;
}

/**
 * Revenue/order-count summary for Today / Yesterday / This Week / Last Week /
 * This Month / Last Month / All Time, computed from completed orders only.
 */
export async function getSalesSummary(): Promise<
  SalesServiceResult<SalesSummary>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("orders")
    .select("total, ordered_at")
    .eq("business_id", context.business.id)
    .eq("status", "completed");

  if (error) return { ok: false, reason: "database_error" };

  const todayStart = startOfToday().getTime();
  const yesterdayStart = addDays(startOfToday(), -1).getTime();
  const weekStart = startOfWeek().getTime();
  const lastWeekStart = addDays(startOfWeek(), -7).getTime();
  const monthStart = startOfMonth().getTime();
  const lastMonthStart = new Date(
    startOfMonth().getFullYear(),
    startOfMonth().getMonth() - 1,
    1,
  ).getTime();

  const empty = (): SalesPeriodStats => ({ revenue: 0, orderCount: 0 });
  const summary: SalesSummary = {
    today: empty(),
    yesterday: empty(),
    week: empty(),
    lastWeek: empty(),
    month: empty(),
    lastMonth: empty(),
    allTime: empty(),
  };

  for (const row of (data ?? []) as Array<{
    total: string | number;
    ordered_at: string;
  }>) {
    const total = toNumber(row.total);
    const orderedAt = new Date(row.ordered_at).getTime();

    summary.allTime.revenue += total;
    summary.allTime.orderCount += 1;

    if (orderedAt >= lastMonthStart && orderedAt < monthStart) {
      summary.lastMonth.revenue += total;
      summary.lastMonth.orderCount += 1;
    }
    if (orderedAt >= monthStart) {
      summary.month.revenue += total;
      summary.month.orderCount += 1;
    }
    if (orderedAt >= lastWeekStart && orderedAt < weekStart) {
      summary.lastWeek.revenue += total;
      summary.lastWeek.orderCount += 1;
    }
    if (orderedAt >= weekStart) {
      summary.week.revenue += total;
      summary.week.orderCount += 1;
    }
    if (orderedAt >= yesterdayStart && orderedAt < todayStart) {
      summary.yesterday.revenue += total;
      summary.yesterday.orderCount += 1;
    }
    if (orderedAt >= todayStart) {
      summary.today.revenue += total;
      summary.today.orderCount += 1;
    }
  }

  return { ok: true, data: summary };
}

/** Latest completed sales with customer display names. */
export async function getRecentSales(
  limit = 10,
): Promise<SalesServiceResult<SaleEntry[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const [{ data, error }, customersResult] = await Promise.all([
    context.supabase
      .from("orders")
      .select("id, order_number, customer_id, total, ordered_at")
      .eq("business_id", context.business.id)
      .eq("status", "completed")
      .order("ordered_at", { ascending: false })
      .limit(limit),
    context.supabase
      .from("customers")
      .select("id, name")
      .eq("business_id", context.business.id),
  ]);

  if (error || customersResult.error) {
    return { ok: false, reason: "database_error" };
  }

  const names = new Map<string, string>();
  for (const row of (customersResult.data ?? []) as Array<{
    id: string;
    name: string;
  }>) {
    names.set(row.id, row.name);
  }

  return {
    ok: true,
    data: ((data ?? []) as Array<{
      id: string;
      order_number: string;
      customer_id: string | null;
      total: string | number;
      ordered_at: string;
    }>).map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      customerName: row.customer_id ? names.get(row.customer_id) ?? null : null,
      total: toNumber(row.total),
      orderedAt: row.ordered_at,
    })),
  };
}

export interface TopSellingProduct {
  productName: string;
  unitsSold: number;
  revenue: number;
  orderCount: number;
}

export interface GetTopProductsOptions {
  /** Look-back window in days (defaults to 30; omit for all time). */
  days?: number;
  limit?: number;
}

/**
 * Best-selling products derived from real completed orders (order items),
 * aggregated server-side. Answers "sabse zyada kya bika?" without loading
 * whole tables into the model.
 */
export async function getTopSellingProducts(
  options: GetTopProductsOptions = {},
): Promise<SalesServiceResult<TopSellingProduct[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const days =
    typeof options.days === "number" && Number.isFinite(options.days) && options.days > 0
      ? Math.floor(options.days)
      : null;
  const limit =
    typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
      ? Math.min(Math.floor(options.limit), 20)
      : 5;

  let query = context.supabase
    .from("order_items")
    .select("product_name, quantity, line_total, orders!inner(status, ordered_at)")
    .eq("business_id", context.business.id)
    .eq("orders.status", "completed");

  if (days !== null) {
    query = query.gte(
      "orders.ordered_at",
      addDays(startOfToday(), -days).toISOString(),
    );
  }

  const { data, error } = await query;
  if (error) return { ok: false, reason: "database_error" };

  const totals = new Map<string, TopSellingProduct>();
  for (const row of (data ?? []) as Array<{
    product_name: string;
    quantity: number;
    line_total: string | number;
  }>) {
    const existing = totals.get(row.product_name) ?? {
      productName: row.product_name,
      unitsSold: 0,
      revenue: 0,
      orderCount: 0,
    };
    existing.unitsSold += row.quantity ?? 0;
    existing.revenue += toNumber(row.line_total);
    existing.orderCount += 1;
    totals.set(row.product_name, existing);
  }

  const ranked = [...totals.values()]
    .sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue)
    .slice(0, limit);
  return { ok: true, data: ranked };
}
