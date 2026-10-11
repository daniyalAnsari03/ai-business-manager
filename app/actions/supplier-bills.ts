"use server";

import {
  createSupplierBill,
  deleteSupplierBill,
  getSupplierBill,
  getSupplierBills,
  updateSupplierBill,
  type SupplierBillServiceError,
} from "@/lib/supplier-bills/service";
import type {
  SupplierBill,
  SupplierBillWithDetails,
} from "@/lib/supplier-bills/types";

export type SupplierBillActionState =
  | { ok: true; bill: SupplierBill }
  | { ok: false; reason: SupplierBillServiceError };

export type SupplierBillListActionState =
  | { ok: true; bills: SupplierBillWithDetails[] }
  | { ok: false; reason: SupplierBillServiceError };

/**
 * Thin server-action boundary over the supplier bill service. Writes go
 * through the wrapper RPCs (`create/update/delete_supplier_bill`) which
 * verify ownership from the session and keep amounts consistent with the
 * ledger; nothing here ever touches supplier_bills directly.
 */

export async function createSupplierBillAction(
  input: unknown,
): Promise<SupplierBillActionState> {
  const result = await createSupplierBill(input);
  return result.ok
    ? { ok: true, bill: result.data }
    : { ok: false, reason: result.reason };
}

export async function updateSupplierBillAction(
  billId: string,
  input: unknown,
): Promise<SupplierBillActionState> {
  const result = await updateSupplierBill(billId, input);
  return result.ok
    ? { ok: true, bill: result.data }
    : { ok: false, reason: result.reason };
}

export async function deleteSupplierBillAction(
  billId: string,
): Promise<{
  ok: true;
  id: string;
} | { ok: false; reason: SupplierBillServiceError }> {
  const result = await deleteSupplierBill(billId);
  return result.ok
    ? { ok: true, id: result.data.id }
    : { ok: false, reason: result.reason };
}

export async function getSupplierBillsAction(
  options: Parameters<typeof getSupplierBills>[0] = {},
): Promise<SupplierBillListActionState> {
  const result = await getSupplierBills(options);
  return result.ok
    ? { ok: true, bills: result.data }
    : { ok: false, reason: result.reason };
}

export async function getSupplierBillAction(
  billId: string,
): Promise<SupplierBillActionState> {
  const result = await getSupplierBill(billId);
  return result.ok
    ? { ok: true, bill: result.data }
    : { ok: false, reason: result.reason };
}