import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import { validateSupplierInput } from "@/lib/suppliers/validation";
import type {
  Supplier,
  SupplierWithOwing,
} from "@/lib/suppliers/types";

/**
 * Supplier service layer — the ONLY place that talks to Supabase about
 * suppliers. Ownership is always derived from the authenticated server-side
 * session (user -> owned business -> supplier.business_id); RLS is the
 * second enforcement layer. Future AI controlled tools should call these
 * same functions instead of duplicating logic.
 *
 * A supplier who has been billed cannot be deleted: the database's composite
 * FK (supplier_bills.supplier_id, supplier_bills.business_id -> suppliers)
 * uses ON DELETE RESTRICT, which surfaces as SQLSTATE 23503. The service maps
 * that to `supplier_has_bills` so the UI can say why (docs/fix.txt).
 */

interface SupplierRow {
  id: string;
  business_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  payment_terms: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    paymentTerms: row.payment_terms,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type SupplierServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "not_found"
  | "supplier_exists"
  | "supplier_has_bills"
  | "database_error";

export type SupplierServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: SupplierServiceError };

/** Resolves the caller's session + owned business, or a failure reason. */
async function requireBusinessContext(): Promise<
  { ok: true; supabase: SupabaseClient; business: Business } | { ok: false; reason: SupplierServiceError }
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

/** Supabase error-codes the service understands (SQLSTATE / PostgREST). */
const UNIQUE_VIOLATION = "23505";
const FK_RESTRICT = "23503";
const NO_ROWS_CODE = "PGRST116";

export interface GetSuppliersOptions {
  /** Case-insensitive match on name / phone / email. */
  search?: string;
}

/**
 * Suppliers of the caller's business, newest first, each enriched with the
 * total it is currently owed (sum of due_amount across its bills).
 */
export async function getSuppliers(
  options: GetSuppliersOptions = {},
): Promise<SupplierServiceResult<SupplierWithOwing[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  let query = context.supabase
    .from("suppliers")
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

  const [{ data: supplierRows, error }, billsResult] = await Promise.all([
    query,
    context.supabase
      .from("supplier_bills")
      .select("supplier_id, due_amount")
      .eq("business_id", context.business.id),
  ]);

  if (error || billsResult.error) return { ok: false, reason: "database_error" };

  const owingBySupplier = new Map<string, number>();
  for (const row of (billsResult.data ?? []) as Array<{
    supplier_id: string;
    due_amount: string | number;
  }>) {
    const due =
      typeof row.due_amount === "number"
        ? row.due_amount
        : Number.parseFloat(row.due_amount) || 0;
    owingBySupplier.set(row.supplier_id, (owingBySupplier.get(row.supplier_id) ?? 0) + due);
  }

  const suppliers = ((supplierRows ?? []) as SupplierRow[]).map((row) => ({
    ...mapSupplier(row),
    totalOwing: owingBySupplier.get(row.id) ?? 0,
  }));

  return { ok: true, data: suppliers };
}

export async function getSupplier(
  supplierId: string,
): Promise<SupplierServiceResult<Supplier>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("suppliers")
    .select("*")
    .eq("id", supplierId)
    .eq("business_id", context.business.id)
    .maybeSingle();

  if (error) return { ok: false, reason: "database_error" };
  if (!data) return { ok: false, reason: "not_found" };
  return { ok: true, data: mapSupplier(data as SupplierRow) };
}

export async function createSupplier(
  input: unknown,
): Promise<SupplierServiceResult<Supplier>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateSupplierInput(input);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  const { data, error } = await context.supabase
    .from("suppliers")
    .insert({
      business_id: context.business.id,
      name: validated.value.name,
      phone: validated.value.phone,
      email: validated.value.email,
      address: validated.value.address,
      payment_terms: validated.value.paymentTerms,
      notes: validated.value.notes,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: "supplier_exists" };
    return { ok: false, reason: "database_error" };
  }
  return { ok: true, data: mapSupplier(data as SupplierRow) };
}

export async function updateSupplier(
  supplierId: string,
  input: unknown,
): Promise<SupplierServiceResult<Supplier>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateSupplierInput(input);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  const { data, error } = await context.supabase
    .from("suppliers")
    .update({
      name: validated.value.name,
      phone: validated.value.phone,
      email: validated.value.email,
      address: validated.value.address,
      payment_terms: validated.value.paymentTerms,
      notes: validated.value.notes,
    })
    .eq("id", supplierId)
    .eq("business_id", context.business.id)
    .select("*")
    .single();

  if (error) {
    if (error.code === NO_ROWS_CODE) return { ok: false, reason: "not_found" };
    if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: "supplier_exists" };
    return { ok: false, reason: "database_error" };
  }
  return { ok: true, data: mapSupplier(data as SupplierRow) };
}

/**
 * Deletes a supplier after explicit UI confirmation. The database refuses
 * (ON DELETE RESTRICT, SQLSTATE 23503) when the supplier still has bills, so
 * money history is never silently erased — the owner must settle/cancel the
 * bills first. That case maps to `supplier_has_bills`.
 */
export async function deleteSupplier(
  supplierId: string,
): Promise<SupplierServiceResult<{ id: string }>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("suppliers")
    .delete()
    .eq("id", supplierId)
    .eq("business_id", context.business.id)
    .select("id")
    .single();

  if (error) {
    if (error.code === NO_ROWS_CODE) return { ok: false, reason: "not_found" };
    if (error.code === FK_RESTRICT) return { ok: false, reason: "supplier_has_bills" };
    return { ok: false, reason: "database_error" };
  }
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/** Real supplier count for the dashboard. */
export async function getSupplierCount(): Promise<
  SupplierServiceResult<number>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { count, error } = await context.supabase
    .from("suppliers")
    .select("id", { count: "exact", head: true })
    .eq("business_id", context.business.id);

  if (error) return { ok: false, reason: "database_error" };
  return { ok: true, data: count ?? 0 };
}