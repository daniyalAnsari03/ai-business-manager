import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import { validateCustomerInput } from "@/lib/customers/validation";
import type {
  Customer,
  CustomerWithStats,
} from "@/lib/customers/types";

/**
 * Customer service layer — the ONLY place that talks to Supabase about
 * customers. Ownership is always derived from the authenticated server-side
 * session (user -> owned business -> customer.business_id); RLS is the
 * second enforcement layer. Future AI controlled tools should call these
 * same functions instead of duplicating logic.
 */

interface CustomerRow {
  id: string;
  business_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CustomerServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "not_found"
  | "database_error";

export type CustomerServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: CustomerServiceError };

/** Resolves the caller's session + owned business, or a failure reason. */
async function requireBusinessContext(): Promise<
  { ok: true; supabase: SupabaseClient; business: Business } | { ok: false; reason: CustomerServiceError }
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

export interface GetCustomersOptions {
  /** Case-insensitive match on name / phone / email. */
  search?: string;
}

/**
 * Customers of the caller's business, newest first, each enriched with real
 * order aggregates (order count excluding cancelled, completed spending).
 */
export async function getCustomers(
  options: GetCustomersOptions = {},
): Promise<CustomerServiceResult<CustomerWithStats[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  let query = context.supabase
    .from("customers")
    .select("*")
    .eq("business_id", context.business.id)
    .order("created_at", { ascending: false });

  const search = options.search?.trim();
  if (search) {
    // Strip PostgREST operator syntax characters from user input.
    const safeTerm = search.replace(/[,()%\\*]/g, " ").trim();
    if (safeTerm.length > 0) {
      query = query.or(
        `name.ilike.%${safeTerm}%,phone.ilike.%${safeTerm}%,email.ilike.%${safeTerm}%`,
      );
    }
  }

  const [{ data: customerRows, error }, ordersResult] = await Promise.all([
    query,
    context.supabase
      .from("orders")
      .select("customer_id, status, total")
      .eq("business_id", context.business.id),
  ]);

  if (error || ordersResult.error) return { ok: false, reason: "database_error" };

  // Aggregate real order history per customer.
  type OrderStatRow = {
    customer_id: string | null;
    status: string;
    total: string | number;
  };
  const statsByCustomer = new Map<string, { totalOrders: number; totalSpent: number }>();
  for (const raw of (ordersResult.data ?? []) as OrderStatRow[]) {
    if (!raw.customer_id) continue;
    if (raw.status === "cancelled") continue;
    const entry = statsByCustomer.get(raw.customer_id) ?? {
      totalOrders: 0,
      totalSpent: 0,
    };
    entry.totalOrders += 1;
    if (raw.status === "completed") {
      entry.totalSpent +=
        typeof raw.total === "number" ? raw.total : Number.parseFloat(raw.total) || 0;
    }
    statsByCustomer.set(raw.customer_id, entry);
  }

  const customers = ((customerRows ?? []) as CustomerRow[]).map((row) => {
    const stats = statsByCustomer.get(row.id);
    return {
      ...mapCustomer(row),
      totalOrders: stats?.totalOrders ?? 0,
      totalSpent: stats?.totalSpent ?? 0,
    };
  });

  return { ok: true, data: customers };
}

const NO_ROWS_CODE = "PGRST116";

export async function getCustomer(
  customerId: string,
): Promise<CustomerServiceResult<Customer>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .eq("business_id", context.business.id)
    .maybeSingle();

  if (error) return { ok: false, reason: "database_error" };
  if (!data) return { ok: false, reason: "not_found" };
  return { ok: true, data: mapCustomer(data as CustomerRow) };
}

export async function createCustomer(
  input: unknown,
): Promise<CustomerServiceResult<Customer>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateCustomerInput(input);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  const { data, error } = await context.supabase
    .from("customers")
    .insert({
      business_id: context.business.id,
      name: validated.value.name,
      phone: validated.value.phone,
      email: validated.value.email,
      address: validated.value.address,
      notes: validated.value.notes,
    })
    .select("*")
    .single();

  if (error) return { ok: false, reason: "database_error" };
  return { ok: true, data: mapCustomer(data as CustomerRow) };
}

export async function updateCustomer(
  customerId: string,
  input: unknown,
): Promise<CustomerServiceResult<Customer>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateCustomerInput(input);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  const { data, error } = await context.supabase
    .from("customers")
    .update({
      name: validated.value.name,
      phone: validated.value.phone,
      email: validated.value.email,
      address: validated.value.address,
      notes: validated.value.notes,
    })
    .eq("id", customerId)
    .eq("business_id", context.business.id)
    .select("*")
    .single();

  if (error) {
    if (error.code === NO_ROWS_CODE) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "database_error" };
  }
  return { ok: true, data: mapCustomer(data as CustomerRow) };
}

/** Deletes a customer after the UI's explicit confirmation. Their orders are
 * preserved in full — only the link is released (ON DELETE SET NULL), so no
 * historical financial record is ever destroyed.
 */
export async function deleteCustomer(
  customerId: string,
): Promise<CustomerServiceResult<{ id: string }>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("customers")
    .delete()
    .eq("id", customerId)
    .eq("business_id", context.business.id)
    .select("id")
    .single();

  if (error) {
    if (error.code === NO_ROWS_CODE) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "database_error" };
  }
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/** Real customer count for the dashboard. */
export async function getCustomerCount(): Promise<
  CustomerServiceResult<number>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { count, error } = await context.supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("business_id", context.business.id);

  if (error) return { ok: false, reason: "database_error" };
  return { ok: true, data: count ?? 0 };
}
