import { state } from "./state.mjs";

/**
 * Scripted service stand-ins for the AI tool tests. The tool modules stay
 * REAL; every business-data read they use to resolve an exact target (orders,
 * customers, suppliers, bills, payment ledger) is handed back from
 * `state.reads`, seeded per test. Named exports cover the FULL surface the
 * `businessTools` registry imports, so the whole tool graph links offline
 * (docs/fix.txt Stage 5: tool tests with in-memory stubs).
 *
 * Writes are recorded so tests can assert the contract (deletion blocked by
 * confirmation, hostile ids ignored) without re-implementing the business
 * services — the REAL service logic is exercised separately against the
 * in-memory Supabase fake in the service tests.
 */

const reads = () =>
  state.reads ?? { customers: [], orders: [], suppliers: [], supplierBills: [], payments: [] };

/* ----------------------------- customers ------------------------------ */

export async function getCustomers() {
  return { ok: true, data: reads().customers };
}

export async function getCustomer(customerId) {
  const customer = reads().customers.find((c) => c.id === customerId) ?? null;
  return customer ? { ok: true, data: customer } : { ok: false, reason: "not_found" };
}

export async function getCustomerCount() {
  return { ok: true, data: reads().customers.length };
}

export async function createCustomer(input) {
  const row = { id: `cust-${reads().customers.length + 1}`, ...input };
  reads().customers.push(row);
  state.lastServiceWrite = { specifier: "customers/service", name: "createCustomer", args: [input], row };
  return { ok: true, data: row };
}

export async function updateCustomer(customerId, input) {
  const rows = reads().customers;
  const idx = rows.findIndex((c) => c.id === customerId);
  if (idx < 0) return { ok: false, reason: "not_found" };
  rows[idx] = { ...rows[idx], ...input };
  state.lastServiceWrite = { specifier: "customers/service", name: "updateCustomer", args: [customerId, input] };
  return { ok: true, data: rows[idx] };
}

export async function deleteCustomer(customerId) {
  const rows = reads().customers;
  const idx = rows.findIndex((c) => c.id === customerId);
  if (idx < 0) return { ok: false, reason: "not_found" };
  const [removed] = rows.splice(idx, 1);
  state.lastServiceWrite = { specifier: "customers/service", name: "deleteCustomer", args: [customerId] };
  return { ok: true, data: removed };
}

/* ------------------------------- orders ------------------------------- */

export async function getOrder(orderId) {
  const order = reads().orders.find((o) => o.id === orderId) ?? null;
  return order ? { ok: true, data: order } : { ok: false, reason: "not_found" };
}

export async function getOrders(options = {}) {
  let orders = reads().orders;
  if (options.search) {
    const needle = String(options.search).trim().toLowerCase();
    orders = orders.filter((o) => (o.orderNumber ?? "").toLowerCase().includes(needle));
  }
  if (options.status && options.status !== "all") {
    orders = orders.filter((o) => o.status === options.status);
  }
  return { ok: true, data: orders };
}

export async function getOrdersByCustomer(customerId, limit) {
  let orders = reads().orders.filter((o) => o.customerId === customerId);
  if (limit) orders = orders.slice(0, limit);
  return { ok: true, data: orders };
}

export async function getOrderStats() {
  return { ok: true, data: { totalOrders: reads().orders.length, revenue: 0 } };
}

export async function getRecentOrders(limit) {
  return { ok: true, data: reads().orders.slice(0, limit ?? 5) };
}

export async function createOrder(input) {
  const row = { id: `order-${reads().orders.length + 1}`, orderNumber: `ORD-${reads().orders.length + 1}`, ...input };
  reads().orders.push(row);
  return { ok: true, data: row };
}

export async function updateOrderStatus(orderId, status) {
  const rows = reads().orders;
  const idx = rows.findIndex((o) => o.id === orderId);
  if (idx < 0) return { ok: false, reason: "not_found" };
  rows[idx] = { ...rows[idx], status };
  return { ok: true, data: rows[idx] };
}

/* ------------------------------ suppliers ----------------------------- */

export async function getSuppliers() {
  return { ok: true, data: reads().suppliers };
}

export async function getSupplier(supplierId) {
  const supplier = reads().suppliers.find((s) => s.id === supplierId) ?? null;
  return supplier ? { ok: true, data: supplier } : { ok: false, reason: "not_found" };
}

export async function createSupplier(input) {
  const row = { id: `sup-${reads().suppliers.length + 1}`, name: input.name, phone: null, email: null, ...input };
  reads().suppliers.push(row);
  state.lastServiceWrite = { specifier: "suppliers/service", name: "createSupplier", args: [input], row };
  return { ok: true, data: row };
}

export async function updateSupplier(supplierId, input) {
  const rows = reads().suppliers;
  const idx = rows.findIndex((s) => s.id === supplierId);
  if (idx < 0) return { ok: false, reason: "not_found" };
  rows[idx] = { ...rows[idx], ...input };
  state.lastServiceWrite = { specifier: "suppliers/service", name: "updateSupplier", args: [supplierId, input] };
  return { ok: true, data: rows[idx] };
}

export async function deleteSupplier(supplierId) {
  const rows = reads().suppliers;
  const idx = rows.findIndex((s) => s.id === supplierId);
  if (idx < 0) return { ok: false, reason: "not_found" };
  rows.splice(idx, 1);
  state.lastServiceWrite = { specifier: "suppliers/service", name: "deleteSupplier", args: [supplierId] };
  return { ok: true, data: { id: supplierId } };
}

/* --------------------------- supplier bills --------------------------- */

export async function getSupplierBills(options = {}) {
  let bills = reads().supplierBills;
  if (options.supplierId) {
    bills = bills.filter((b) => b.supplierId === options.supplierId);
  }
  if (options.search) {
    const needle = String(options.search).trim().toLowerCase();
    bills = bills.filter((b) => (b.billNumber ?? "").toLowerCase().includes(needle));
  }
  return { ok: true, data: bills };
}

export async function getSupplierBill(billId) {
  const bill = reads().supplierBills.find((b) => b.id === billId) ?? null;
  return bill ? { ok: true, data: bill } : { ok: false, reason: "not_found" };
}

export async function createSupplierBill(input) {
  const row = { id: `bill-${reads().supplierBills.length + 1}`, ...input, dueAmount: input.total ?? 0, status: "unpaid" };
  reads().supplierBills.push(row);
  state.lastServiceWrite = { specifier: "supplier-bills/service", name: "createSupplierBill", args: [input], row };
  return { ok: true, data: row };
}

/* ------------------------------ payments ------------------------------ */

export async function getPayment(paymentId) {
  const entry = reads().payments.find((p) => p.id === paymentId) ?? null;
  return entry ? { ok: true, data: entry } : { ok: false, reason: "not_found" };
}

export async function listPayments(options = {}) {
  let entries = reads().payments;
  if (options.orderId) entries = entries.filter((p) => p.orderId === options.orderId);
  if (options.supplierBillId) entries = entries.filter((p) => p.supplierBillId === options.supplierBillId);
  return { ok: true, data: entries };
}

export async function listOrderPaymentSummaries() {
  return { ok: true, data: [] };
}