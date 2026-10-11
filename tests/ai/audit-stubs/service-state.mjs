// Shared mutable state so the stubs and the test agree on what the fake service
// layer returns, and on what the fake audit_logs insert does, per case.
export const serviceState = {
  // { ok: true, data: Product[] } | { ok: false, reason }
  products: { ok: true, data: [] },
  // { ok: true, data: CustomerWithStats[] } | { ok: false, reason }
  customers: { ok: true, data: [] },
  // { ok: true, data: OrderListItem[] } | { ok: false, reason }
  orders: { ok: true, data: [] },
  // { ok: true, data: Expense[] } | { ok: false, reason }
  expenses: { ok: true, data: [] },
  // The stored business profile (Business | null).
  business: null,
  // Product ids the marketing draft hook was fired for (not audited here).
  marketingDrafts: [],

  // Per-operation overrides. When null the stub derives a realistic success
  // result from the fixtures above; when set, that exact result is returned
  // (used to simulate a backend failure).
  updateStockResult: null,
  adjustStockResult: null,
  deleteProductResult: null,
  createOrderResult: null,
  updateOrderStatusResult: null,
  createProductResult: null,
  updateProductResult: null,
  createCustomerResult: null,
  updateCustomerResult: null,
  deleteCustomerResult: null,
  createExpenseResult: null,
  updateExpenseResult: null,
  deleteExpenseResult: null,
  updateBusinessResult: null,

  audit: {
    /** Rows the tool layer asked to write (already sanitized by the helper). */
    rows: [],
    /** When set, the fake insert fails with this message. */
    insertError: null,
    /** When false, getSupabaseAdminClient() returns null (no service key). */
    adminAvailable: true,
  },
};

export function resetAudit() {
  serviceState.audit.rows = [];
  serviceState.audit.insertError = null;
  serviceState.audit.adminAvailable = true;
  serviceState.updateStockResult = null;
  serviceState.adjustStockResult = null;
  serviceState.deleteProductResult = null;
  serviceState.createOrderResult = null;
  serviceState.updateOrderStatusResult = null;
  serviceState.createProductResult = null;
  serviceState.updateProductResult = null;
  serviceState.createCustomerResult = null;
  serviceState.updateCustomerResult = null;
  serviceState.deleteCustomerResult = null;
  serviceState.createExpenseResult = null;
  serviceState.updateExpenseResult = null;
  serviceState.deleteExpenseResult = null;
  serviceState.updateBusinessResult = null;
}
