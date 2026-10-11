/** Supplier bill domain types shared by the service layer, server actions and UI. */

export type SupplierBillStatus = "unpaid" | "partial" | "paid";

export interface SupplierBill {
  id: string;
  businessId: string;
  supplierId: string;
  /** The SUPPLIER's own bill number (their reference, usually null). */
  billNumber: string | null;
  /** ISO date (YYYY-MM-DD). */
  billDate: string;
  /** ISO date (YYYY-MM-DD) or null. */
  dueDate: string | null;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  status: SupplierBillStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A bill joined with its supplier's display name for list/detail screens. */
export interface SupplierBillWithDetails extends SupplierBill {
  supplierName: string;
}

export interface SupplierBillInput {
  supplierId: string;
  subtotal: number;
  discount: number;
  billNumber: string | null;
  billDate: string | null;
  dueDate: string | null;
  notes: string | null;
}