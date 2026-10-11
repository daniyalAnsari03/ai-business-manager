import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import { validateSupplierBillInput } from "@/lib/supplier-bills/validation";
import type {
  SupplierBill,
  SupplierBillWithDetails,
} from "@/lib/supplier-bills/types";

/**
 * Supplier bill service layer.
 *
 * WRITES never go through PostgREST: `supplier_bills` has no INSERT/UPDATE/
 * DELETE policy and authenticated has no table-level write grants. A bill is
 * created/edited/deleted ONLY via the wrapper RPCs, which resolve the business
 * from the session, lock the row, validate amounts and keep paid/due/status
 * consistent with the payment ledger. Reads are plain SELECTs under RLS.
 *
 * Error codes returned by the RPCs (`NO_BUSINESS`, `INVALID_AMOUNT`,
 * `BILL_BELOW_PAID`, `HAS_PAYMENTS`, ...) are mapped to stable reason codes
 * the UI can localise (docs/fix.txt). Nothing source-level reaches the client.
 */

export type SupplierBillServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "not_found"
  | "supplier_invalid"
  | "supplier_not_found"
  | "invalid_amount"
  | "bill_total_invalid"
  | "bill_number_invalid"
  | "bill_date_invalid"
  | "invalid_notes"
  | "bill_paid_not_editable"
  | "bill_below_paid"
  | "has_payments"
  | "database_error";

export type SupplierBillServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: SupplierBillServiceError };

interface BillRow {
  id: string;
  business_id: string;
  supplier_id: string;
  bill_number: string | null;
  bill_date: string;
  due_date: string | null;
  subtotal: string | number;
  discount: string | number;
  total: string | number;
  paid_amount: string | number;
  due_amount: string | number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseFloat(value) || 0;
}

function mapBill(row: BillRow): SupplierBill {
  return {
    id: row.id,
    businessId: row.business_id,
    supplierId: row.supplier_id,
    billNumber: row.bill_number,
    billDate: row.bill_date,
    dueDate: row.due_date,
    subtotal: toNumber(row.subtotal),
    discount: toNumber(row.discount),
    total: toNumber(row.total),
    paidAmount: toNumber(row.paid_amount),
    dueAmount: toNumber(row.due_amount),
    status: row.status as SupplierBill["status"],
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function requireBusinessContext(): Promise<
  { ok: true; supabase: SupabaseClient; business: Business } | { ok: false; reason: SupplierBillServiceError }
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

/** Maps a wrapper-RPC `error` code to a stable reason the UI can localise. */
function mapRpcError(code: string | null | undefined): SupplierBillServiceError {
  switch (code) {
    case "NO_BUSINESS":
      return "no_business";
    case "NOT_FOUND":
      return "not_found";
    case "SUPPLIER_REQUIRED":
    case "SUPPLIER_NOT_FOUND":
      return "supplier_not_found";
    case "SUPPLIER_INVALID":
      return "supplier_invalid";
    case "INVALID_AMOUNT":
      return "invalid_amount";
    case "BILL_TOTAL_INVALID":
      return "bill_total_invalid";
    case "BILL_NUMBER_INVALID":
      return "bill_number_invalid";
    case "BILL_DATE_INVALID":
      return "bill_date_invalid";
    case "INVALID_NOTES":
      return "invalid_notes";
    case "BILL_PAID_NOT_EDITABLE":
      return "bill_paid_not_editable";
    case "BILL_BELOW_PAID":
      return "bill_below_paid";
    case "HAS_PAYMENTS":
      return "has_payments";
    default:
      return "database_error";
  }
}

type RpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: SupplierBillServiceError };

/** Reads `{ ok: false, error: "CODE" }` from a successful jsonb RPC call. */
function readBinary<R>(result: { data: unknown; error: unknown }): RpcResult<R> {
  if (result.error) return { ok: false, reason: "database_error" };
  const body = result.data as { ok?: boolean; error?: string } | null;
  if (!body) return { ok: false, reason: "database_error" };
  if (body.ok === false) return { ok: false, reason: mapRpcError(body.error) };
  return { ok: true, data: body as R };
}

export interface GetSupplierBillsOptions {
  supplierId?: string;
  status?: SupplierBill["status"];
  search?: string;
}

/**
 * Bills of the caller's business, newest first, with the supplier's name
 * attached. Reads are RLS-protected SELECTs; no amount is ever invented here.
 */
export async function getSupplierBills(
  options: GetSupplierBillsOptions = {},
): Promise<SupplierBillServiceResult<SupplierBillWithDetails[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  let query = context.supabase
    .from("supplier_bills")
    .select("*")
    .eq("business_id", context.business.id)
    .order("bill_date", { ascending: false });

  if (options.supplierId) query = query.eq("supplier_id", options.supplierId);
  if (options.status) query = query.eq("status", options.status);

  const search = options.search?.trim();
  if (search) {
    const safeTerm = search.replace(/[,()%\\*]/g, " ").trim();
    if (safeTerm.length > 0) {
      query = query.or(
        `bill_number.ilike.%${safeTerm}%,notes.ilike.%${safeTerm}%`,
      );
    }
  }

  const { data: rows, error } = await query;
  if (error) return { ok: false, reason: "database_error" };

  const bills = (rows ?? []) as BillRow[];
  const supplierIds = [...new Set(bills.map((b) => b.supplier_id))];

  const { data: suppliers, error: suppliersError } =
    supplierIds.length > 0
      ? await context.supabase
          .from("suppliers")
          .select("id, name")
          .in("id", supplierIds)
      : { data: [], error: null };
  if (suppliersError) return { ok: false, reason: "database_error" };

  const nameById = new Map(
    ((suppliers ?? []) as Array<{ id: string; name: string }>).map((s) => [
      s.id,
      s.name,
    ]),
  );

  return {
    ok: true,
    data: bills.map((row) => ({
      ...mapBill(row),
      supplierName: nameById.get(row.supplier_id) ?? "—",
    })),
  };
}

export async function getSupplierBill(
  billId: string,
): Promise<SupplierBillServiceResult<SupplierBillWithDetails>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data: row, error } = await context.supabase
    .from("supplier_bills")
    .select("*")
    .eq("id", billId)
    .eq("business_id", context.business.id)
    .maybeSingle();

  if (error) return { ok: false, reason: "database_error" };
  if (!row) return { ok: false, reason: "not_found" };

  const bill = mapBill(row as BillRow);
  const { data: supplier, error: supplierError } = await context.supabase
    .from("suppliers")
    .select("name")
    .eq("id", bill.supplierId)
    .eq("business_id", context.business.id)
    .maybeSingle();

  if (supplierError) return { ok: false, reason: "database_error" };
  return {
    ok: true,
    data: {
      ...bill,
      supplierName: (supplier as { name: string } | null)?.name ?? "—",
    },
  };
}

export async function createSupplierBill(
  input: unknown,
): Promise<SupplierBillServiceResult<SupplierBill>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateSupplierBillInput(input);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  const { data, error } = await context.supabase.rpc("create_supplier_bill", {
    p_payload: {
      supplierId: validated.value.supplierId,
      subtotal: validated.value.subtotal,
      discount: validated.value.discount,
      billNumber: validated.value.billNumber ?? undefined,
      billDate: validated.value.billDate ?? undefined,
      dueDate: validated.value.dueDate ?? undefined,
      notes: validated.value.notes ?? undefined,
    },
  });

  const result = readBinary<{ bill: BillRow }>({ data, error });
  if (!result.ok) return result;
  return { ok: true, data: mapBill(result.data.bill) };
}

export async function updateSupplierBill(
  billId: string,
  input: unknown,
): Promise<SupplierBillServiceResult<SupplierBill>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateSupplierBillInput(input);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  const { data, error } = await context.supabase.rpc("update_supplier_bill", {
    p_bill_id: billId,
    p_payload: {
      subtotal: validated.value.subtotal,
      discount: validated.value.discount,
      billNumber: validated.value.billNumber ?? undefined,
      billDate: validated.value.billDate ?? undefined,
      dueDate: validated.value.dueDate ?? undefined,
      notes: validated.value.notes ?? undefined,
    },
  });

  const result = readBinary<{ bill: BillRow }>({ data, error });
  if (!result.ok) return result;
  return { ok: true, data: mapBill(result.data.bill) };
}

export async function deleteSupplierBill(
  billId: string,
): Promise<SupplierBillServiceResult<{ id: string }>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase.rpc("delete_supplier_bill", {
    p_bill_id: billId,
  });

  const result = readBinary<{ deleted: boolean }>({ data, error });
  if (!result.ok) return result;
  return { ok: true, data: { id: billId } };
}