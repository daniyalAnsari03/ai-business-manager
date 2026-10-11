"use server";

import {
  createSupplier,
  deleteSupplier,
  getSupplier,
  getSuppliers,
  updateSupplier,
  type SupplierServiceError,
} from "@/lib/suppliers/service";
import type { Supplier, SupplierWithOwing } from "@/lib/suppliers/types";

export type SupplierActionState =
  | { ok: true; supplier: Supplier }
  | { ok: false; reason: SupplierServiceError };

export type SupplierListActionState =
  | { ok: true; suppliers: SupplierWithOwing[] }
  | { ok: false; reason: SupplierServiceError };

/**
 * Thin server-action boundary over the supplier service. Inputs stay
 * `unknown` on purpose — validation and ownership happen inside the
 * service, never in the browser.
 */

export async function createSupplierAction(
  input: unknown,
): Promise<SupplierActionState> {
  const result = await createSupplier(input);
  return result.ok
    ? { ok: true, supplier: result.data }
    : { ok: false, reason: result.reason };
}

export async function updateSupplierAction(
  supplierId: string,
  input: unknown,
): Promise<SupplierActionState> {
  const result = await updateSupplier(supplierId, input);
  return result.ok
    ? { ok: true, supplier: result.data }
    : { ok: false, reason: result.reason };
}

export async function deleteSupplierAction(
  supplierId: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: SupplierServiceError }> {
  const result = await deleteSupplier(supplierId);
  return result.ok
    ? { ok: true, id: result.data.id }
    : { ok: false, reason: result.reason };
}

export async function getSuppliersAction(
  options: Parameters<typeof getSuppliers>[0] = {},
): Promise<SupplierListActionState> {
  const result = await getSuppliers(options);
  return result.ok
    ? { ok: true, suppliers: result.data }
    : { ok: false, reason: result.reason };
}

export async function getSupplierAction(
  supplierId: string,
): Promise<SupplierActionState> {
  const result = await getSupplier(supplierId);
  return result.ok
    ? { ok: true, supplier: result.data }
    : { ok: false, reason: result.reason };
}