/** Supplier domain types shared by the service layer, server actions and UI. */

export interface Supplier {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTerms: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInput {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTerms: string | null;
  notes: string | null;
}

/**
 * A supplier enriched with the single number that matters on the list screen:
 * how much the business currently owes them (sum of unpaid bill due_amount).
 */
export interface SupplierWithOwing extends Supplier {
  /** Sum of due_amount across this supplier's unpaid/partial bills. */
  totalOwing: number;
}