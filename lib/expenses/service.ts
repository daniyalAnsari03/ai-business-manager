import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import { getServerUser, getSupabaseServerClient } from "@/lib/supabase/server";
import { validateExpenseInput } from "@/lib/expenses/validation";
import { isExpenseCategory } from "@/lib/expenses/types";
import type {
  Expense,
  ExpenseCategory,
} from "@/lib/expenses/types";

/**
 * Expense service layer — the ONLY place that talks to Supabase about
 * expenses. Ownership is always derived from the authenticated server-side
 * session (user -> owned business -> expense.business_id); RLS is the
 * second enforcement layer. Future AI controlled tools should call these
 * same functions instead of duplicating logic.
 */

interface ExpenseRow {
  id: string;
  business_id: string;
  title: string;
  amount: string | number;
  category: string;
  expense_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapExpense(row: ExpenseRow): Expense {
  const amount =
    typeof row.amount === "number" ? row.amount : Number.parseFloat(row.amount);
  return {
    id: row.id,
    businessId: row.business_id,
    title: row.title,
    amount: Number.isFinite(amount) ? amount : 0,
    category: (isExpenseCategory(row.category) ? row.category : "other") as ExpenseCategory,
    expenseDate: row.expense_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ExpenseServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "not_found"
  | "database_error";

export type ExpenseServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ExpenseServiceError };

async function requireBusinessContext(): Promise<
  { ok: true; supabase: SupabaseClient; business: Business } | { ok: false; reason: ExpenseServiceError }
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

export interface GetExpensesOptions {
  /** Case-insensitive match on title / notes. */
  search?: string;
}

/** Expenses of the caller's business, newest date first. */
export async function getExpenses(
  options: GetExpensesOptions = {},
): Promise<ExpenseServiceResult<Expense[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  let query = context.supabase
    .from("expenses")
    .select("*")
    .eq("business_id", context.business.id)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  const search = options.search?.trim();
  if (search) {
    // Strip PostgREST operator syntax characters from user input.
    const safeTerm = search.replace(/[,()%\\*]/g, " ").trim();
    if (safeTerm.length > 0) {
      query = query.or(`title.ilike.%${safeTerm}%,notes.ilike.%${safeTerm}%`);
    }
  }

  const { data, error } = await query;
  if (error) return { ok: false, reason: "database_error" };

  return { ok: true, data: ((data ?? []) as ExpenseRow[]).map(mapExpense) };
}

const NO_ROWS_CODE = "PGRST116";

export async function createExpense(
  input: unknown,
): Promise<ExpenseServiceResult<Expense>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateExpenseInput(input);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  const { data, error } = await context.supabase
    .from("expenses")
    .insert({
      business_id: context.business.id,
      title: validated.value.title,
      amount: validated.value.amount,
      category: validated.value.category,
      expense_date: validated.value.expenseDate,
      notes: validated.value.notes,
    })
    .select("*")
    .single();

  if (error) return { ok: false, reason: "database_error" };
  return { ok: true, data: mapExpense(data as ExpenseRow) };
}

export async function updateExpense(
  expenseId: string,
  input: unknown,
): Promise<ExpenseServiceResult<Expense>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateExpenseInput(input);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  const { data, error } = await context.supabase
    .from("expenses")
    .update({
      title: validated.value.title,
      amount: validated.value.amount,
      category: validated.value.category,
      expense_date: validated.value.expenseDate,
      notes: validated.value.notes,
    })
    .eq("id", expenseId)
    .eq("business_id", context.business.id)
    .select("*")
    .single();

  if (error) {
    if (error.code === NO_ROWS_CODE) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "database_error" };
  }
  return { ok: true, data: mapExpense(data as ExpenseRow) };
}

/** Deletes an expense after explicit confirmation in the UI. */
export async function deleteExpense(
  expenseId: string,
): Promise<ExpenseServiceResult<{ id: string }>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("expenses")
    .delete()
    .eq("id", expenseId)
    .eq("business_id", context.business.id)
    .select("id")
    .single();

  if (error) {
    if (error.code === NO_ROWS_CODE) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "database_error" };
  }
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export interface ExpenseCategoryTotal {
  category: ExpenseCategory;
  total: number;
}

export interface LargestExpense {
  title: string;
  amount: number;
  date: string;
}

export interface ExpenseStats {
  /** Sum of today's expenses. */
  todayTotal: number;
  /** Sum of this calendar week's (Mon-based) expenses. */
  weekTotal: number;
  /** Sum of this calendar month's expenses. */
  monthTotal: number;
  /** Sum of every recorded expense. */
  allTimeTotal: number;
  /** Number of expenses recorded this calendar month. */
  monthCount: number;
  /** Number of recorded expenses overall. */
  allTimeCount: number;
  /** This month's totals per category, largest first. */
  monthByCategory: ExpenseCategoryTotal[];
  /** Biggest single expense of this calendar month, if any. */
  largestThisMonth: LargestExpense | null;
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Real totals + breakdown for the Expenses page, dashboard and AI tools. */
export async function getExpenseStats(): Promise<
  ExpenseServiceResult<ExpenseStats>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("expenses")
    .select("title, amount, category, expense_date")
    .eq("business_id", context.business.id);

  if (error) return { ok: false, reason: "database_error" };

  const now = new Date();
  const todayStart = startOfToday().getTime();
  // Weeks start on Monday, matching the sales service definitions.
  const weekday = now.getDay();
  const weekStart = new Date(todayStart - (weekday === 0 ? 6 : weekday - 1) * 86_400_000).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let todayTotal = 0;
  let weekTotal = 0;
  let monthTotal = 0;
  let allTimeTotal = 0;
  let monthCount = 0;
  let allTimeCount = 0;
  const categoryTotals = new Map<ExpenseCategory, number>();
  let largestThisMonth: LargestExpense | null = null;

  for (const row of (data ?? []) as Array<{
    title: string;
    amount: string | number;
    category: string;
    expense_date: string;
  }>) {
    const amount =
      typeof row.amount === "number"
        ? row.amount
        : Number.parseFloat(row.amount) || 0;
    const dateMs = new Date(`${row.expense_date}T00:00:00`).getTime();

    allTimeTotal += amount;
    allTimeCount += 1;

    if (dateMs >= monthStart) {
      monthTotal += amount;
      monthCount += 1;
      const category: ExpenseCategory = isExpenseCategory(row.category)
        ? row.category
        : "other";
      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + amount);
      if (largestThisMonth === null || amount > largestThisMonth.amount) {
        largestThisMonth = { title: row.title, amount, date: row.expense_date };
      }
    }
    if (dateMs >= weekStart) weekTotal += amount;
    if (dateMs >= todayStart) todayTotal += amount;
  }

  const monthByCategory = [...categoryTotals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);

  return {
    ok: true,
    data: {
      todayTotal,
      weekTotal,
      monthTotal,
      allTimeTotal,
      monthCount,
      allTimeCount,
      monthByCategory,
      largestThisMonth,
    },
  };
}
