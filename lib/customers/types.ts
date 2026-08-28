/** Customer domain types shared by the service layer, server actions and UI. */

export interface Customer {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerInput {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

/** Real per-customer aggregates derived from this business's orders. */
export interface CustomerOrderStats {
  totalOrders: number;
  totalSpent: number;
}

export type CustomerWithStats = Customer & CustomerOrderStats;

export interface CustomerListStats {
  totalCustomers: number;
}
