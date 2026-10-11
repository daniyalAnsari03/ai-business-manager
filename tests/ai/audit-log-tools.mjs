/**
 * Offline test of the audit_log wiring for the AI tools.
 *
 * Group 1 (docs/1b.txt): set_product_stock, adjust_product_stock, create_order,
 * update_order_status, delete_product.
 * Group 2 (docs/1c.txt): create_product, update_product, create_customer,
 * update_customer, delete_customer, create_expense, update_expense,
 * delete_expense, update_business_profile.
 *
 * The tools' REAL execute() logic runs; only the product/order/customer/
 * expense/business services and the service-role Supabase client are stubbed,
 * so the audit rows can be inspected with no Supabase, secrets or business data.
 *
 * For each tool this verifies:
 *   (a) a confirmed action writes exactly one row with the right before/after;
 *   (b) a failed, rejected, awaiting-confirmation or no-op action writes none;
 *   (c) a failing audit insert never breaks the business action;
 *   (d) business_id comes from the server-side run context, never from a
 *       model-supplied value;
 *   (e) no personal field value (phone/email/address/notes) appears in any row.
 *
 * Run: node --conditions=react-server --import ./tests/ai/register-audit-hooks.mjs tests/ai/audit-log-tools.mjs
 */

/* ---------------------------------------------------------------------------
 * Environment dummies (module loading only — no Supabase call is made here).
 * ------------------------------------------------------------------------ */
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://stub.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "stub-anon-key";

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

function check(name, passed, detail = "") {
  record(name, Boolean(passed), detail);
}

const { serviceState, resetAudit } = await import("./audit-stubs/service-state.mjs");
const {
  setProductStockTool,
  adjustProductStockTool,
  deleteProductTool,
  createProductTool,
  updateProductTool,
  findProductTool,
  listProductsTool,
  lowStockTool,
} = await import("../../lib/ai/tools/product-tools.ts");
const { createOrderTool, updateOrderStatusTool } = await import(
  "../../lib/ai/tools/order-tools.ts"
);
const { createCustomerTool, updateCustomerTool, deleteCustomerTool } = await import(
  "../../lib/ai/tools/customer-tools.ts"
);
const { createExpenseTool, updateExpenseTool, deleteExpenseTool } = await import(
  "../../lib/ai/tools/expense-tools.ts"
);
const { updateBusinessProfileTool } = await import("../../lib/ai/tools/business-tools.ts");

/* ---------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */
const CONTEXT_BUSINESS = "11111111-1111-4111-8111-111111111111";
const HOSTILE_BUSINESS = "99999999-9999-4999-8999-999999999999";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CORRELATION_ID = "chat-request-correlation-1";

// Personal values seeded into the fixtures. The cross-cutting check (e) proves
// none of these can ever reach a row — neither as a value nor as part of a
// stored field-name list.
const CUSTOMER_PHONE = "0300-1234567";
const CUSTOMER_EMAIL = "ahmed.private@example.com";
const CUSTOMER_ADDRESS = "House 12, Street 4, Gulberg, Lahore";
const CUSTOMER_NOTES = "AIM very loyal customer, call after 6pm";
/** Second set of personal values, used as the NEW values the tools write. */
const CUSTOMER_PHONE_2 = "0301-2223333";
const CUSTOMER_EMAIL_2 = "bilal.private@example.com";
const CUSTOMER_ADDRESS_2 = "Flat 7, Street 9, Model Town, Lahore";
const CUSTOMER_NOTES_2 = "New note written by the assistant";
const EXPENSE_NOTES = "Paid in cash to landlord personally";
const EXPENSE_NOTES_2 = "Paid by bank transfer to the landlord";
const BUSINESS_PHONE = "0300-9999999";
const BUSINESS_PHONE_2 = "0301-8884444";
const BUSINESS_ADDRESS = "Office 5, Mall Road, Islamabad";
const BUSINESS_ADDRESS_2 = "Office 8, Blue Area, Islamabad";
const PERSONAL_VALUES = [
  CUSTOMER_PHONE,
  CUSTOMER_EMAIL,
  CUSTOMER_ADDRESS,
  CUSTOMER_NOTES,
  CUSTOMER_PHONE_2,
  CUSTOMER_EMAIL_2,
  CUSTOMER_ADDRESS_2,
  CUSTOMER_NOTES_2,
  EXPENSE_NOTES,
  EXPENSE_NOTES_2,
  BUSINESS_PHONE,
  BUSINESS_PHONE_2,
  BUSINESS_ADDRESS,
  BUSINESS_ADDRESS_2,
];

const PRODUCT = {
  id: "33333333-3333-4333-8333-333333333333",
  businessId: CONTEXT_BUSINESS,
  name: "Black Kurta",
  description: null,
  category: "Kurta",
  price: 1500,
  stockQuantity: 12,
  lowStockThreshold: 5,
  sku: "BK-01",
  imageUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const CUSTOMER = {
  id: "55555555-5555-4555-8555-555555555555",
  businessId: CONTEXT_BUSINESS,
  name: "Ahmed Khan",
  phone: CUSTOMER_PHONE,
  email: CUSTOMER_EMAIL,
  address: CUSTOMER_ADDRESS,
  notes: CUSTOMER_NOTES,
  totalOrders: 3,
  totalSpent: 9000,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const EXPENSE = {
  id: "66666666-6666-4666-8666-666666666666",
  businessId: CONTEXT_BUSINESS,
  title: "Shop rent",
  amount: 25000,
  category: "rent",
  expenseDate: "2026-01-01",
  notes: EXPENSE_NOTES,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const BUSINESS = {
  id: CONTEXT_BUSINESS,
  ownerId: USER_ID,
  name: "Test Shop",
  businessType: "retail_shop",
  currency: "PKR",
  language: "en",
  phone: BUSINESS_PHONE,
  address: BUSINESS_ADDRESS,
  setupCompleted: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const ORDER = {
  id: "44444444-4444-4444-8444-444444444444",
  businessId: CONTEXT_BUSINESS,
  customerId: null,
  orderNumber: "ORD-104",
  status: "pending",
  subtotal: 3000,
  discount: 0,
  total: 3000,
  notes: null,
  orderedAt: "2026-01-02T00:00:00.000Z",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  customerName: null,
  items: [
    {
      id: "order-item-1",
      orderId: "44444444-4444-4444-8444-444444444444",
      businessId: CONTEXT_BUSINESS,
      productId: PRODUCT.id,
      productName: "Black Kurta",
      unitPrice: 1500,
      quantity: 2,
      lineTotal: 3000,
    },
  ],
};

serviceState.products = { ok: true, data: [PRODUCT] };
serviceState.customers = { ok: true, data: [CUSTOMER] };
serviceState.orders = { ok: true, data: [ORDER] };
serviceState.expenses = { ok: true, data: [EXPENSE] };
serviceState.business = BUSINESS;

function runContext(contextOverrides = {}) {
  return {
    context: {
      businessId: CONTEXT_BUSINESS,
      businessName: "Test Shop",
      businessType: "retail",
      currencyCode: "PKR",
      currencySymbol: "Rs",
      language: "en",
      userId: USER_ID,
      correlationId: CORRELATION_ID,
      ...contextOverrides,
    },
  };
}

/** Runs a tool with an isolated audit sink and a captured console.error. */
async function run(tool, args, options = {}) {
  resetAudit();
  if (options.setup) options.setup();
  const originalError = console.error;
  const errors = [];
  console.error = (...parts) => {
    errors.push(parts.map((part) => (part instanceof Error ? part.message : String(part))).join(" "));
  };
  let parsed = null;
  let thrown = null;
  try {
    const raw = await tool.invoke(options.runContext ?? runContext(), JSON.stringify(args));
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  } finally {
    console.error = originalError;
  }
  return { parsed, thrown, rows: serviceState.audit.rows, errors };
}

const json = (value) => JSON.stringify(value);
const onlyRow = (rows) => (rows.length === 1 ? rows[0] : null);

/**
 * Cross-cutting (e): a personal value from any fixture (customer phone/email/
 * address/notes, expense notes, business phone/address) must never appear in a
 * row, in any nesting. Field NAMES such as "phone" are allowed (and used) to
 * record THAT a personal field changed — its value never is.
 */
function personalValueLeaks(rows) {
  const leaks = [];
  for (const row of rows) {
    const text = json(row);
    for (const value of PERSONAL_VALUES) {
      if (text.includes(value)) leaks.push(`${row?.action ?? "?"} leaked "${value}"`);
    }
  }
  return leaks;
}

/** Asserts (e) plus the writer's own guarantee that such keys carry no value. */
function expectNoPersonalLeak(rows, label) {
  const leaks = personalValueLeaks(rows);
  check(
    `${label} (e) no personal value (phone/email/address/notes) appears in any row`,
    leaks.length === 0,
    leaks.join(", "),
  );
}

function expectAuditShape(row, { action, entity, entityId, before, after }) {
  const problems = [];
  if (!row) return ["no single audit row was written"];
  if (row.action !== action) problems.push(`action=${row.action}`);
  if (row.entity !== entity) problems.push(`entity=${row.entity}`);
  if (row.entity_id !== entityId) problems.push(`entity_id=${row.entity_id}`);
  if (row.business_id !== CONTEXT_BUSINESS) problems.push(`business_id=${row.business_id}`);
  if (row.actor_type !== "ai") problems.push(`actor_type=${row.actor_type}`);
  if (row.actor_id !== USER_ID) problems.push(`actor_id=${row.actor_id}`);
  if (row.correlation_id !== CORRELATION_ID) problems.push(`correlation_id=${row.correlation_id}`);
  if (json(row.before) !== json(before)) problems.push(`before=${json(row.before)}`);
  if (json(row.after) !== json(after)) problems.push(`after=${json(row.after)}`);
  return problems;
}

/* ===========================================================================
 * 1. set_product_stock
 * ========================================================================= */
{
  const out = await run(setProductStockTool, {
    productName: "Black Kurta",
    newStock: 50,
  });
  const row = onlyRow(out.rows);
  const problems = expectAuditShape(row, {
    action: "stock.set",
    entity: "product",
    entityId: PRODUCT.id,
    before: { stock_quantity: 12 },
    after: { stock_quantity: 50 },
  });
  check(
    "set_product_stock (a) success -> exactly one stock.set row with before/after",
    out.parsed?.status === "ok" && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(setProductStockTool, { productName: "Black Kurta", newStock: 50 }, {
    setup: () => {
      serviceState.updateStockResult = { ok: false, reason: "database_error" };
    },
  });
  check(
    "set_product_stock (b) backend failure -> tool fails and writes no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(setProductStockTool, { productName: "Black Kurta", newStock: 50 });
  const retry = await run(setProductStockTool, { productName: "Nonexistent", newStock: 5 });
  check(
    "set_product_stock (b) unknown product -> no audit row",
    out.rows.length === 1 && retry.parsed?.status === "error" && retry.rows.length === 0,
    `rejected rows=${retry.rows.length}`,
  );
}

{
  const out = await run(setProductStockTool, { productName: "Black Kurta", newStock: 50 }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "set_product_stock (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null &&
      out.parsed?.status === "ok" &&
      out.parsed?.updated === true &&
      out.parsed?.product?.stock === 50 &&
      out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
  check(
    "set_product_stock (c) audit insert failure -> visible server error, no audit claim to the model",
    out.errors.some((line) => line.includes("[audit]") && line.includes("NOT WRITTEN")) &&
      !("audit" in (out.parsed ?? {})) &&
      !json(out.parsed).includes("audit"),
    out.errors[0] ?? "no error logged",
  );
}

{
  const out = await run(setProductStockTool, {
    productName: "Black Kurta",
    newStock: 50,
    // Hostile extra input: the model must never be able to choose the business.
    businessId: HOSTILE_BUSINESS,
    business_id: HOSTILE_BUSINESS,
  });
  check(
    "set_product_stock (d) business_id comes from the run context, not model input",
    out.rows.length === 1 &&
      out.rows[0].business_id === CONTEXT_BUSINESS &&
      out.rows[0].business_id !== HOSTILE_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

/* ===========================================================================
 * 2. adjust_product_stock
 * ========================================================================= */
{
  const out = await run(adjustProductStockTool, { productName: "Black Kurta", delta: 8 });
  const row = onlyRow(out.rows);
  const problems = expectAuditShape(row, {
    action: "stock.adjust",
    entity: "product",
    entityId: PRODUCT.id,
    before: { stock_quantity: 12 },
    after: { stock_quantity: 20 },
  });
  check(
    "adjust_product_stock (a) success -> exactly one stock.adjust row with before/after",
    out.parsed?.status === "ok" && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(adjustProductStockTool, { productName: "Black Kurta", delta: -50 });
  check(
    "adjust_product_stock (b) rejected change (not enough stock) -> no audit row",
    out.parsed?.status === "error" && out.parsed?.reason === "insufficient_stock" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status} reason=${out.parsed?.reason}`,
  );
}

{
  const out = await run(adjustProductStockTool, { productName: "Black Kurta", delta: 8 }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "adjust_product_stock (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null && out.parsed?.status === "ok" && out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(adjustProductStockTool, {
    productName: "Black Kurta",
    delta: 8,
    businessId: HOSTILE_BUSINESS,
  });
  check(
    "adjust_product_stock (d) business_id comes from the run context, not model input",
    out.rows.length === 1 && out.rows[0].business_id === CONTEXT_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

/* ===========================================================================
 * 3. create_order
 * ========================================================================= */
{
  const out = await run(createOrderTool, {
    items: [{ productName: "Black Kurta", quantity: 2 }],
    status: "completed",
  });
  const row = onlyRow(out.rows);
  const problems = expectAuditShape(row, {
    action: "order.create",
    entity: "order",
    entityId: "order-201",
    before: null,
    after: {
      order_number: "ORD-201",
      order_status: "completed",
      customer_id: null,
      subtotal: 3000,
      discount: 0,
      total: 3000,
      items: [{ product_id: PRODUCT.id, quantity: 2, unit_price: 1500 }],
    },
  });
  check(
    "create_order (a) success -> exactly one order.create row with before=null and an after summary",
    out.parsed?.status === "ok" && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
  check(
    "create_order (a) after snapshot stores no customer phone/address/notes",
    out.rows.length === 1 &&
      !json(out.rows[0].after).includes("phone") &&
      !json(out.rows[0].after).includes("address"),
    json(out.rows[0]?.after),
  );
}

{
  const out = await run(createOrderTool, { items: [{ productName: "Silk Saree", quantity: 1 }] });
  check(
    "create_order (b) unresolvable product -> clarification, no order, no audit row",
    out.parsed?.status === "needs_clarification" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(createOrderTool, { items: [{ productName: "Black Kurta", quantity: 2 }] }, {
    setup: () => {
      serviceState.createOrderResult = { ok: false, reason: "insufficient_stock" };
    },
  });
  check(
    "create_order (b) backend failure -> tool fails and writes no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(createOrderTool, { items: [{ productName: "Black Kurta", quantity: 2 }] }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "create_order (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null &&
      out.parsed?.status === "ok" &&
      out.parsed?.created === true &&
      out.parsed?.orderNumber === "ORD-201" &&
      out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(createOrderTool, {
    items: [{ productName: "Black Kurta", quantity: 2 }],
    businessId: HOSTILE_BUSINESS,
    business_id: HOSTILE_BUSINESS,
  });
  check(
    "create_order (d) business_id comes from the run context, not model input",
    out.rows.length === 1 && out.rows[0].business_id === CONTEXT_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

/* ===========================================================================
 * 4. update_order_status
 * ========================================================================= */
{
  const out = await run(updateOrderStatusTool, {
    orderNumber: "ORD-104",
    status: "completed",
  });
  const row = onlyRow(out.rows);
  const problems = expectAuditShape(row, {
    action: "order.status_update",
    entity: "order",
    entityId: ORDER.id,
    before: { order_status: "pending" },
    after: { order_status: "completed" },
  });
  check(
    "update_order_status (a) success -> exactly one order.status_update row with before/after",
    out.parsed?.status === "ok" && out.parsed?.updated === true && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateOrderStatusTool, { orderNumber: "ORD-104", status: "cancelled" });
  check(
    "update_order_status (b) awaiting confirmation -> asks the user, writes no audit row",
    out.parsed?.status === "needs_confirmation" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateOrderStatusTool, { orderNumber: "ORD-104", status: "pending" });
  check(
    "update_order_status (b) already in that status (no-op) -> no audit row",
    out.parsed?.status === "ok" && out.parsed?.already_in_status === true && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateOrderStatusTool, { orderNumber: "ORD-999", status: "completed" });
  check(
    "update_order_status (b) unknown order -> no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateOrderStatusTool, { orderNumber: "ORD-104", status: "completed" }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "update_order_status (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null &&
      out.parsed?.status === "ok" &&
      out.parsed?.newStatus === "completed" &&
      out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(updateOrderStatusTool, {
    orderNumber: "ORD-104",
    status: "completed",
    businessId: HOSTILE_BUSINESS,
  });
  check(
    "update_order_status (d) business_id comes from the run context, not model input",
    out.rows.length === 1 && out.rows[0].business_id === CONTEXT_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

/* ===========================================================================
 * 5. delete_product
 * ========================================================================= */
{
  const out = await run(deleteProductTool, { productName: "Black Kurta", confirmed: true });
  const row = onlyRow(out.rows);
  const problems = expectAuditShape(row, {
    action: "product.delete",
    entity: "product",
    entityId: PRODUCT.id,
    before: { name: "Black Kurta", sku: "BK-01", category: "Kurta", price: 1500, stock: 12 },
    after: null,
  });
  check(
    "delete_product (a) confirmed -> exactly one product.delete row with a safe before snapshot",
    out.parsed?.status === "ok" && out.parsed?.removed === true && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(deleteProductTool, { productName: "Black Kurta", confirmed: false });
  check(
    "delete_product (b) awaiting confirmation -> asks the user, writes no audit row",
    out.parsed?.status === "needs_confirmation" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(deleteProductTool, { productName: "Black Kurta", confirmed: true }, {
    setup: () => {
      serviceState.deleteProductResult = { ok: false, reason: "database_error" };
    },
  });
  check(
    "delete_product (b) backend failure -> tool fails and writes no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(deleteProductTool, { productName: "Black Kurta", confirmed: true }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "delete_product (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null && out.parsed?.status === "ok" && out.parsed?.removed === true && out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(deleteProductTool, {
    productName: "Black Kurta",
    confirmed: true,
    businessId: HOSTILE_BUSINESS,
  });
  check(
    "delete_product (d) business_id comes from the run context, not model input",
    out.rows.length === 1 && out.rows[0].business_id === CONTEXT_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

/* ===========================================================================
 * 6. create_product
 * ========================================================================= */
{
  const out = await run(createProductTool, {
    name: "White Kurta",
    category: "Kurta",
    price: 1800,
    stockQuantity: 7,
  });
  const problems = expectAuditShape(onlyRow(out.rows), {
    action: "product.create",
    entity: "product",
    entityId: "product-new",
    before: null,
    after: {
      name: "White Kurta",
      sku: null,
      category: "Kurta",
      price: 1800,
      stock_quantity: 7,
      // File 3 / Phase 2: a creation with nothing clothing-related said still
      // records the honest defaults — no invented attribute, the label unit and
      // a cost price that is explicitly "not set".
      unit: "Piece",
      attributes: {},
      cost_price: null,
    },
  });
  check(
    "create_product (a) success -> exactly one product.create row with before=null and an after summary",
    out.parsed?.status === "ok" && out.parsed?.created === true && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(createProductTool, { name: "Broken", category: "Kurta", price: 100 }, {
    setup: () => {
      serviceState.createProductResult = { ok: false, reason: "database_error" };
    },
  });
  check(
    "create_product (b) backend failure -> tool fails and writes no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(createProductTool, { name: "White Kurta", category: "Kurta", price: 1800 }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "create_product (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null &&
      out.parsed?.status === "ok" &&
      out.parsed?.created === true &&
      out.parsed?.product?.name === "White Kurta" &&
      out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(createProductTool, {
    name: "White Kurta",
    category: "Kurta",
    price: 1800,
    businessId: HOSTILE_BUSINESS,
    business_id: HOSTILE_BUSINESS,
  });
  check(
    "create_product (d) business_id comes from the run context, not model input",
    out.rows.length === 1 && out.rows[0].business_id === CONTEXT_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

/* ===========================================================================
 * 7. update_product
 * ========================================================================= */
{
  const out = await run(updateProductTool, { productName: "Black Kurta", price: 1800 });
  const problems = expectAuditShape(onlyRow(out.rows), {
    action: "product.update",
    entity: "product",
    entityId: PRODUCT.id,
    before: { price: 1500 },
    after: { price: 1800 },
  });
  check(
    "update_product (a) success -> one product.update row holding ONLY the changed field",
    out.parsed?.status === "ok" && out.parsed?.updated === true && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateProductTool, {
    productName: "Black Kurta",
    name: "Black Kurta Premium",
    category: "Formal",
    sku: "BK-02",
    lowStockThreshold: 9,
  });
  const row = onlyRow(out.rows);
  check(
    "update_product (a) several fields change -> each changed field appears in before and after",
    out.rows.length === 1 &&
      row.action === "product.update" &&
      json(row.before) === json({
        name: "Black Kurta",
        category: "Kurta",
        sku: "BK-01",
        low_stock_threshold: 5,
      }) &&
      json(row.after) === json({
        name: "Black Kurta Premium",
        category: "Formal",
        sku: "BK-02",
        low_stock_threshold: 9,
      }),
    json({ before: row?.before, after: row?.after }),
  );
  check(
    "update_product (a) unchanged fields are NOT copied into the snapshot",
    out.rows.length === 1 &&
      !("price" in (row.before ?? {})) &&
      !("stock_quantity" in (row.after ?? {})) &&
      !("description" in (row.after ?? {})),
    json({ before: row?.before, after: row?.after }),
  );
}

{
  const out = await run(updateProductTool, { productName: "Nonexistent", price: 10 });
  check(
    "update_product (b) unknown product -> no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateProductTool, { productName: "Kurta", price: 10 }, {
    setup: () => {
      serviceState.products = {
        ok: true,
        data: [PRODUCT, { ...PRODUCT, id: "77777777-7777-4777-8777-777777777777", name: "Black Kurta Shalwar" }],
      };
    },
  });
  serviceState.products = { ok: true, data: [PRODUCT] };
  check(
    "update_product (b) ambiguous match -> clarification, nothing changed, no audit row",
    out.parsed?.status === "needs_clarification" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateProductTool, { productName: "Black Kurta", price: 1500 });
  check(
    "update_product (b) saving identical values (no-op) -> no audit row",
    out.parsed?.status === "ok" && out.parsed?.updated === true && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateProductTool, { productName: "Broken", price: 10 }, {
    setup: () => {
      serviceState.updateProductResult = { ok: false, reason: "database_error" };
    },
  });
  check(
    "update_product (b) backend failure -> tool fails and writes no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateProductTool, { productName: "Black Kurta", price: 1800 }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "update_product (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null &&
      out.parsed?.status === "ok" &&
      out.parsed?.product?.price === 1800 &&
      out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(updateProductTool, {
    productName: "Black Kurta",
    price: 1800,
    businessId: HOSTILE_BUSINESS,
  });
  check(
    "update_product (d) business_id comes from the run context, not model input",
    out.rows.length === 1 && out.rows[0].business_id === CONTEXT_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

/* ===========================================================================
 * 8. create_customer
 * ========================================================================= */
{
  const out = await run(createCustomerTool, {
    name: "Bilal Ahmed",
    phone: CUSTOMER_PHONE_2,
    email: CUSTOMER_EMAIL_2,
    address: CUSTOMER_ADDRESS_2,
    notes: CUSTOMER_NOTES_2,
  });
  const problems = expectAuditShape(onlyRow(out.rows), {
    action: "customer.create",
    entity: "customer",
    entityId: "customer-new",
    before: null,
    after: { id: "customer-new", name: "Bilal Ahmed" },
  });
  check(
    "create_customer (a) success -> one customer.create row with before=null and id+name only",
    out.parsed?.status === "ok" && out.parsed?.created === true && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
  expectNoPersonalLeak(out.rows, "create_customer");
}

{
  const out = await run(createCustomerTool, { name: "Broken", phone: CUSTOMER_PHONE_2 }, {
    setup: () => {
      serviceState.createCustomerResult = { ok: false, reason: "invalid_input" };
    },
  });
  check(
    "create_customer (b) backend failure -> tool fails and writes no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(createCustomerTool, { name: "Bilal Ahmed", phone: CUSTOMER_PHONE_2 }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "create_customer (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null && out.parsed?.status === "ok" && out.parsed?.created === true && out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(createCustomerTool, {
    name: "Bilal Ahmed",
    phone: CUSTOMER_PHONE_2,
    businessId: HOSTILE_BUSINESS,
    business_id: HOSTILE_BUSINESS,
  });
  check(
    "create_customer (d) business_id comes from the run context, not model input",
    out.rows.length === 1 && out.rows[0].business_id === CONTEXT_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

{
  // Same-name duplicate guard: no customer is created here, the existing record
  // is edited, so history must say customer.update and not customer.create.
  const out = await run(createCustomerTool, { name: CUSTOMER.name, phone: CUSTOMER_PHONE_2 });
  const row = onlyRow(out.rows);
  check(
    "create_customer (a) same-name duplicate guard -> recorded as customer.update, not customer.create",
    out.parsed?.status === "ok" &&
      out.parsed?.updated_existing === true &&
      out.rows.length === 1 &&
      row?.action === "customer.update" &&
      row?.entity === "customer" &&
      row?.entity_id === CUSTOMER.id &&
      json(row?.after?.changed_fields) === json(["phone", "email", "address", "notes"]),
    json(row ?? null),
  );
  expectNoPersonalLeak(out.rows, "create_customer duplicate guard");
}

/* ===========================================================================
 * 9. update_customer
 * ========================================================================= */
{
  const out = await run(updateCustomerTool, {
    customerId: CUSTOMER.id,
    name: "Ahmed Raza Khan",
  });
  const problems = expectAuditShape(onlyRow(out.rows), {
    action: "customer.update",
    entity: "customer",
    entityId: CUSTOMER.id,
    before: { name: "Ahmed Khan" },
    after: { name: "Ahmed Raza Khan" },
  });
  check(
    "update_customer (a) name change -> one customer.update row with old/new name",
    out.parsed?.status === "ok" && out.parsed?.updated === true && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateCustomerTool, {
    customerId: CUSTOMER.id,
    phone: CUSTOMER_PHONE_2,
    email: CUSTOMER_EMAIL_2,
    address: CUSTOMER_ADDRESS_2,
    notes: CUSTOMER_NOTES_2,
  });
  const row = onlyRow(out.rows);
  check(
    "update_customer (a) contact details change -> row stores only the NAMES of the changed fields",
    out.rows.length === 1 &&
      row?.action === "customer.update" &&
      json(row?.before) === json({ changed_fields: ["phone", "email", "address", "notes"] }) &&
      json(row?.after) === json({ changed_fields: ["phone", "email", "address", "notes"] }),
    json({ before: row?.before, after: row?.after }),
  );
  expectNoPersonalLeak(out.rows, "update_customer contact details");
}

{
  const out = await run(updateCustomerTool, { customerName: "Nobody Here", phone: CUSTOMER_PHONE_2 });
  check(
    "update_customer (b) unknown customer -> no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateCustomerTool, { customerName: "Ahmed", phone: CUSTOMER_PHONE_2 }, {
    setup: () => {
      serviceState.customers = {
        ok: true,
        data: [
          CUSTOMER,
          { ...CUSTOMER, id: "88888888-8888-4888-8888-888888888888", name: "Ahmed Sheikh" },
        ],
      };
    },
  });
  serviceState.customers = { ok: true, data: [CUSTOMER] };
  check(
    "update_customer (b) ambiguous match -> clarification, nothing changed, no audit row",
    out.parsed?.status === "needs_clarification" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateCustomerTool, { customerId: CUSTOMER.id, name: CUSTOMER.name });
  check(
    "update_customer (b) saving identical values (no-op) -> no audit row",
    out.parsed?.status === "ok" && out.parsed?.updated === true && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateCustomerTool, { customerId: CUSTOMER.id, name: "Broken Name" }, {
    setup: () => {
      serviceState.updateCustomerResult = { ok: false, reason: "database_error" };
    },
  });
  check(
    "update_customer (b) backend failure -> tool fails and writes no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateCustomerTool, { customerId: CUSTOMER.id, name: "Ahmed Raza Khan" }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "update_customer (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null &&
      out.parsed?.status === "ok" &&
      out.parsed?.customer?.name === "Ahmed Raza Khan" &&
      out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(updateCustomerTool, {
    customerId: CUSTOMER.id,
    name: "Ahmed Raza Khan",
    businessId: HOSTILE_BUSINESS,
  });
  check(
    "update_customer (d) business_id comes from the run context, not model input",
    out.rows.length === 1 && out.rows[0].business_id === CONTEXT_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

/* ===========================================================================
 * 10. create_expense
 * ========================================================================= */
{
  const out = await run(createExpenseTool, {
    title: "Electricity bill",
    amount: 4200,
    category: "utilities",
    expenseDate: "2026-02-05",
    notes: EXPENSE_NOTES,
  });
  const problems = expectAuditShape(onlyRow(out.rows), {
    action: "expense.create",
    entity: "expense",
    entityId: "expense-new",
    before: null,
    after: { title: "Electricity bill", amount: 4200, category: "utilities", expense_date: "2026-02-05" },
  });
  check(
    "create_expense (a) success -> one expense.create row with before=null and title/amount/category/date",
    out.parsed?.status === "ok" && out.parsed?.created === true && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
  expectNoPersonalLeak(out.rows, "create_expense");
}

{
  const out = await run(createExpenseTool, { title: "Broken", amount: 100, category: "other" }, {
    setup: () => {
      serviceState.createExpenseResult = { ok: false, reason: "invalid_input" };
    },
  });
  check(
    "create_expense (b) backend failure -> tool fails and writes no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(createExpenseTool, { title: "Broken", amount: 100, category: "other" }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "create_expense (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null && out.parsed?.status === "ok" && out.parsed?.created === true && out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(createExpenseTool, {
    title: "Fuel",
    amount: 3000,
    category: "transport",
    businessId: HOSTILE_BUSINESS,
  });
  check(
    "create_expense (d) business_id comes from the run context, not model input",
    out.rows.length === 1 && out.rows[0].business_id === CONTEXT_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

/* ===========================================================================
 * 11. update_expense
 * ========================================================================= */
{
  const out = await run(updateExpenseTool, { expenseId: EXPENSE.id, amount: 27000 });
  const problems = expectAuditShape(onlyRow(out.rows), {
    action: "expense.update",
    entity: "expense",
    entityId: EXPENSE.id,
    before: { amount: 25000 },
    after: { amount: 27000 },
  });
  check(
    "update_expense (a) success -> one expense.update row holding ONLY the changed field",
    out.parsed?.status === "ok" && out.parsed?.updated === true && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateExpenseTool, {
    expenseId: EXPENSE.id,
    title: "Warehouse rent",
    category: "utilities",
    expenseDate: "2026-03-01",
  });
  const row = onlyRow(out.rows);
  check(
    "update_expense (a) several fields change -> each changed field appears in before and after",
    out.rows.length === 1 &&
      json(row?.before) === json({ title: "Shop rent", category: "rent", expense_date: "2026-01-01" }) &&
      json(row?.after) === json({ title: "Warehouse rent", category: "utilities", expense_date: "2026-03-01" }),
    json({ before: row?.before, after: row?.after }),
  );
  check(
    "update_expense (a) unchanged fields are NOT copied into the snapshot",
    out.rows.length === 1 && !("amount" in (row?.before ?? {})) && !("notes" in (row?.after ?? {})),
    json({ before: row?.before, after: row?.after }),
  );
}

{
  const out = await run(updateExpenseTool, { expenseId: EXPENSE.id, notes: EXPENSE_NOTES_2 });
  const row = onlyRow(out.rows);
  check(
    "update_expense (a) notes change -> row stores only the field name, never the note text",
    out.rows.length === 1 && json(row?.after) === json({ changed_fields: ["notes"] }),
    json(row?.after ?? null),
  );
  expectNoPersonalLeak(out.rows, "update_expense notes");
}

{
  const out = await run(updateExpenseTool, { expenseTitle: "Nothing at all", amount: 500 });
  check(
    "update_expense (b) unknown expense -> no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateExpenseTool, { expenseTitle: "rent", amount: 500 }, {
    setup: () => {
      serviceState.expenses = {
        ok: true,
        data: [
          EXPENSE,
          { ...EXPENSE, id: "99999999-9999-4999-8999-999999999911", title: "Warehouse rent" },
        ],
      };
    },
  });
  serviceState.expenses = { ok: true, data: [EXPENSE] };
  check(
    "update_expense (b) ambiguous match -> clarification, nothing changed, no audit row",
    out.parsed?.status === "needs_clarification" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateExpenseTool, { expenseId: EXPENSE.id, amount: 25000 });
  check(
    "update_expense (b) saving identical values (no-op) -> no audit row",
    out.parsed?.status === "ok" && out.parsed?.updated === true && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateExpenseTool, { expenseId: EXPENSE.id, amount: 1 }, {
    setup: () => {
      serviceState.updateExpenseResult = { ok: false, reason: "database_error" };
    },
  });
  check(
    "update_expense (b) backend failure -> tool fails and writes no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateExpenseTool, { expenseId: EXPENSE.id, amount: 27000 }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "update_expense (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null &&
      out.parsed?.status === "ok" &&
      out.parsed?.expense?.amount === 27000 &&
      out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(updateExpenseTool, {
    expenseId: EXPENSE.id,
    amount: 27000,
    businessId: HOSTILE_BUSINESS,
  });
  check(
    "update_expense (d) business_id comes from the run context, not model input",
    out.rows.length === 1 && out.rows[0].business_id === CONTEXT_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

/* ===========================================================================
 * 12. delete_expense
 * ========================================================================= */
{
  const out = await run(deleteExpenseTool, { expenseTitle: "Shop rent", confirmed: true });
  const problems = expectAuditShape(onlyRow(out.rows), {
    action: "expense.delete",
    entity: "expense",
    entityId: EXPENSE.id,
    before: { title: "Shop rent", amount: 25000, category: "rent", expense_date: "2026-01-01" },
    after: null,
  });
  check(
    "delete_expense (a) confirmed -> exactly one expense.delete row with the prior expense summary",
    out.parsed?.status === "ok" && out.parsed?.removed === true && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
  expectNoPersonalLeak(out.rows, "delete_expense");
}

{
  const out = await run(deleteExpenseTool, { expenseTitle: "Shop rent", confirmed: false });
  check(
    "delete_expense (b) awaiting confirmation -> asks the user, writes no audit row",
    out.parsed?.status === "needs_confirmation" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(deleteExpenseTool, { expenseTitle: "Nothing at all", confirmed: true });
  check(
    "delete_expense (b) unknown expense -> no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(deleteExpenseTool, { expenseTitle: "Shop rent", confirmed: true }, {
    setup: () => {
      serviceState.deleteExpenseResult = { ok: false, reason: "database_error" };
    },
  });
  check(
    "delete_expense (b) backend failure -> tool fails and writes no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(deleteExpenseTool, { expenseTitle: "Shop rent", confirmed: true }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "delete_expense (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null && out.parsed?.status === "ok" && out.parsed?.removed === true && out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(deleteExpenseTool, {
    expenseTitle: "Shop rent",
    confirmed: true,
    businessId: HOSTILE_BUSINESS,
  });
  check(
    "delete_expense (d) business_id comes from the run context, not model input",
    out.rows.length === 1 && out.rows[0].business_id === CONTEXT_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

/* ===========================================================================
 * 13. delete_customer
 * ========================================================================= */
{
  const out = await run(deleteCustomerTool, { customerId: CUSTOMER.id, confirmed: true });
  const problems = expectAuditShape(onlyRow(out.rows), {
    action: "customer.delete",
    entity: "customer",
    entityId: CUSTOMER.id,
    before: { id: CUSTOMER.id, name: CUSTOMER.name },
    after: null,
  });
  check(
    "delete_customer (a) confirmed -> exactly one customer.delete row with id+name only",
    out.parsed?.status === "ok" && out.parsed?.removed === true && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
  expectNoPersonalLeak(out.rows, "delete_customer");
}

{
  const out = await run(deleteCustomerTool, { customerId: CUSTOMER.id, confirmed: false });
  check(
    "delete_customer (b) awaiting confirmation -> asks the user, writes no audit row",
    out.parsed?.status === "needs_confirmation" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(deleteCustomerTool, { customerName: "Nobody Here", confirmed: true });
  check(
    "delete_customer (b) unknown customer -> no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(deleteCustomerTool, { customerId: CUSTOMER.id, confirmed: true }, {
    setup: () => {
      serviceState.deleteCustomerResult = { ok: false, reason: "database_error" };
    },
  });
  check(
    "delete_customer (b) backend failure -> tool fails and writes no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(deleteCustomerTool, { customerId: CUSTOMER.id, confirmed: true }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "delete_customer (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null && out.parsed?.status === "ok" && out.parsed?.removed === true && out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(deleteCustomerTool, {
    customerId: CUSTOMER.id,
    confirmed: true,
    businessId: HOSTILE_BUSINESS,
  });
  check(
    "delete_customer (d) business_id comes from the run context, not model input",
    out.rows.length === 1 && out.rows[0].business_id === CONTEXT_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

/* ===========================================================================
 * 14. update_business_profile
 * ========================================================================= */
{
  const out = await run(updateBusinessProfileTool, { name: "Renamed Shop" });
  const problems = expectAuditShape(onlyRow(out.rows), {
    action: "business.update",
    entity: "business",
    entityId: BUSINESS.id,
    before: { name: "Test Shop" },
    after: { name: "Renamed Shop" },
  });
  check(
    "update_business_profile (a) name change -> one business.update row with old/new name",
    out.parsed?.status === "ok" && out.parsed?.updated === true && out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateBusinessProfileTool, {
    businessType: "restaurant_food",
    currency: "USD",
    language: "ur",
  });
  const row = onlyRow(out.rows);
  check(
    "update_business_profile (a) several fields change -> each changed field appears in before and after",
    out.rows.length === 1 &&
      json(row?.before) === json({ business_type: "retail_shop", currency: "PKR", language: "en" }) &&
      json(row?.after) === json({ business_type: "restaurant_food", currency: "USD", language: "ur" }),
    json({ before: row?.before, after: row?.after }),
  );
}

{
  const out = await run(updateBusinessProfileTool, {
    phone: BUSINESS_PHONE_2,
    address: BUSINESS_ADDRESS_2,
  });
  const row = onlyRow(out.rows);
  check(
    "update_business_profile (a) phone/address change -> row stores only the changed field NAMES",
    out.rows.length === 1 &&
      json(row?.before) === json({ changed_fields: ["phone", "address"] }) &&
      json(row?.after) === json({ changed_fields: ["phone", "address"] }),
    json({ before: row?.before, after: row?.after }),
  );
  expectNoPersonalLeak(out.rows, "update_business_profile contact details");
}

{
  const out = await run(updateBusinessProfileTool, { currency: "ZZZ" });
  check(
    "update_business_profile (b) invalid input -> tool fails and writes no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateBusinessProfileTool, { name: "Renamed Shop" }, {
    setup: () => {
      serviceState.updateBusinessResult = { ok: false, reason: "database_error" };
    },
  });
  check(
    "update_business_profile (b) backend failure -> tool fails and writes no audit row",
    out.parsed?.status === "error" && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateBusinessProfileTool, { name: "Test Shop" });
  check(
    "update_business_profile (b) saving identical values (no-op) -> no audit row",
    out.parsed?.status === "ok" && out.parsed?.updated === true && out.rows.length === 0,
    `rows=${out.rows.length} status=${out.parsed?.status}`,
  );
}

{
  const out = await run(updateBusinessProfileTool, { name: "Renamed Shop" }, {
    setup: () => {
      serviceState.audit.insertError = "stub insert failure";
    },
  });
  check(
    "update_business_profile (c) audit insert failure -> action still succeeds, no row",
    out.thrown === null &&
      out.parsed?.status === "ok" &&
      out.parsed?.business?.name === "Renamed Shop" &&
      out.rows.length === 0,
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(updateBusinessProfileTool, {
    name: "Renamed Shop",
    businessId: HOSTILE_BUSINESS,
    business_id: HOSTILE_BUSINESS,
  });
  check(
    "update_business_profile (d) business_id comes from the run context, not model input",
    out.rows.length === 1 && out.rows[0].business_id === CONTEXT_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

{
  // No server-side run context at all: the tool must still perform and report
  // the business change, and simply not record history it cannot attribute.
  const out = await run(updateBusinessProfileTool, { name: "Renamed Shop" }, {
    runContext: { context: { language: "en" } },
  });
  check(
    "update_business_profile business action survives a missing run context (no attributable row)",
    out.thrown === null &&
      out.parsed?.status === "ok" &&
      out.parsed?.business?.name === "Renamed Shop" &&
      out.rows.length === 0 &&
      out.errors.some((line) => line.includes("[audit]")),
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

/* ===========================================================================
 * 15. Cross-cutting guarantees
 * ========================================================================= */
{
  const out = await run(setProductStockTool, { productName: "Black Kurta", newStock: 50 }, {
    setup: () => {
      serviceState.audit.adminAvailable = false;
    },
  });
  check(
    "No service-role client -> tool still succeeds and the gap is logged",
    out.thrown === null &&
      out.parsed?.status === "ok" &&
      out.rows.length === 0 &&
      out.errors.some((line) => line.includes("[audit]")),
    `thrown=${out.thrown} status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

{
  const out = await run(setProductStockTool, { productName: "Black Kurta", newStock: 50 }, {
    runContext: runContext({ userId: undefined, correlationId: undefined }),
  });
  check(
    "Missing user id / correlation id still records the row (both are optional)",
    out.rows.length === 1 && out.rows[0].actor_id === null && out.rows[0].correlation_id === null,
    json(out.rows[0] ?? null),
  );
}

{
  // Defence in depth: even if a future caller passes something sensitive, the
  // writer strips it before the row is persisted.
  const { writeAuditLog } = await import("../../lib/audit/write-audit-log.ts");
  const written = await run(
    { invoke: () => writeAuditLog({
        businessId: CONTEXT_BUSINESS,
        actorType: "ai",
        action: "stock.set",
        entity: "product",
        entityId: PRODUCT.id,
        after: {
          stock_quantity: 12,
          api_key: "sk-live-should-never-be-stored",
          customerPhone: "0300-1234567",
          address: "somewhere",
        },
      }) },
    {},
  );
  const row = written.rows[0];
  check(
    "Writer strips secret/personal keys from snapshots before persisting",
    written.rows.length === 1 &&
      row?.after?.stock_quantity === 12 &&
      row?.after?.api_key === "[redacted]" &&
      row?.after?.customerPhone === "[redacted]" &&
      row?.after?.address === "[redacted]" &&
      !json(row).includes("sk-live-should-never-be-stored"),
    json(row?.after ?? null),
  );
  check(
    "Writer reports failure instead of throwing when the insert fails",
    (await run(
      {
        invoke: () => writeAuditLog({
          businessId: CONTEXT_BUSINESS,
          actorType: "ai",
          action: "stock.set",
          entity: "product",
        }),
      },
      {},
      { setup: () => { serviceState.audit.insertError = "stub insert failure"; } },
    )).parsed.ok === false,
  );
}

{
  // Sanity: the same request-scoped correlation id is reused for every tool call
  // in one turn, and a different request gets a different id.
  const first = await run(setProductStockTool, { productName: "Black Kurta", newStock: 40 });
  const second = await run(adjustProductStockTool, { productName: "Black Kurta", delta: 1 });
  check(
    "All tool calls in one request share the context correlation id",
    first.rows.length === 1 &&
      second.rows.length === 1 &&
      first.rows[0].correlation_id === second.rows[0].correlation_id &&
      first.rows[0].correlation_id === CORRELATION_ID,
    `${first.rows[0]?.correlation_id} / ${second.rows[0]?.correlation_id}`,
  );
}

/* ===========================================================================
 * 16. Clothing attributes, unit label and cost price (docs/p2.txt)
 *
 * The tool layer must map the FLAT model parameters onto the stored fields,
 * hand every value to the server-side validators, report a rejected value as a
 * clear honest failure (never a silent ignore) and record the new fields in
 * history. The service behaviour behind these checks (merge, removal, business
 * type gate, defaults) is proven against the real service in
 * tests/products/product-service-extras.mjs.
 * ========================================================================= */
const CLOTHING_BUSINESS = { ...BUSINESS, businessType: "clothing_fashion" };
const CLOTHING_PRODUCT = {
  ...PRODUCT,
  name: "Blue Suit",
  sku: null,
  attributes: { fabric: "Cotton", color: "Black" },
  unit: "Piece",
  costPrice: null,
};

/** A clothing shop whose stored product already has attributes. */
function asClothingShop() {
  serviceState.business = CLOTHING_BUSINESS;
  serviceState.products = { ok: true, data: [CLOTHING_PRODUCT] };
}

/** Back to the default retail_shop fixture the other sections expect. */
function asRetailShop() {
  serviceState.business = BUSINESS;
  serviceState.products = { ok: true, data: [PRODUCT] };
}

/**
 * The chat route always builds the run context from the AUTHENTICATED
 * business, so a clothing shop's tools run under its real type. The checks
 * below need that context because the product summary hides attributes for a
 * business type without the fabric_attributes capability — which is exactly
 * what check 16k proves.
 */
function clothingRunContext() {
  return runContext({ businessType: "clothing_fashion" });
}

/* 16a. Create with clothing fields: values are stored in their canonical
 *      spelling and the audit row carries all three new fields. */
{
  const out = await run(
    createProductTool,
    {
      name: "Lawn Suit",
      category: "Suits",
      price: 4200,
      stockQuantity: 12,
      product_type: "shirt / kameez ",
      fabric: "  lawn  ",
      color: "black",
      design: "handwork",
      size: "free size",
      unit: " meter ",
      cost_price: 2400.5,
    },
    { setup: asClothingShop, runContext: clothingRunContext() },
  );
  asRetailShop();
  const row = onlyRow(out.rows);
  check(
    "create_product (new fields) clothing values are stored in canonical spelling",
    out.parsed?.status === "ok" &&
      json(out.parsed?.product?.attributes) ===
        json({
          product_type: "Shirt / Kameez",
          fabric: "Lawn",
          color: "Black",
          design: "Handwork",
          size: "Free Size",
        }),
    json(out.parsed?.product?.attributes ?? null),
  );
  check(
    "create_product (new fields) the unit label is canonicalised and the cost price stored",
    out.parsed?.product?.unit === "Meter" && out.parsed?.product?.cost_price === 2400.5,
    `unit=${json(out.parsed?.product?.unit)} cost_price=${json(out.parsed?.product?.cost_price)}`,
  );
  check(
    "create_product (new fields) the audit row stores attributes, unit and cost_price",
    out.rows.length === 1 &&
      json(row?.after?.attributes) === json(out.parsed?.product?.attributes) &&
      row?.after?.unit === "Meter" &&
      row?.after?.cost_price === 2400.5 &&
      row?.business_id === CONTEXT_BUSINESS,
    json(row ?? null),
  );
}

/* 16b. A custom value nobody could enumerate is accepted as typed. */
{
  const out = await run(
    createProductTool,
    {
      name: "Chikankari Kurti",
      category: "Kurta",
      price: 2600,
      design: "Chikankari Special",
      fabric: "Chikankari",
    },
    { setup: asClothingShop, runContext: clothingRunContext() },
  );
  asRetailShop();
  check(
    "create_product (new fields) a custom attribute value the user typed is stored as typed",
    out.parsed?.status === "ok" &&
      out.parsed?.product?.attributes?.design === "Chikankari Special" &&
      out.parsed?.product?.attributes?.fabric === "Chikankari",
    json(out.parsed?.product?.attributes ?? null),
  );
}

/* 16c. A value the validator rejects fails LOUDLY: a clear message for the
 *      model to pass on, and no history row for a change that never happened. */
{
  const out = await run(
    createProductTool,
    { name: "Bad Fabric", category: "Suits", price: 1000, fabric: "x".repeat(61) },
    { setup: asClothingShop, runContext: clothingRunContext() },
  );
  asRetailShop();
  check(
    "create_product (new fields) an over-long attribute is rejected with a clear message, no audit row",
    out.parsed?.status === "error" &&
      /60 characters or fewer/.test(String(out.parsed?.hint ?? "")) &&
      out.parsed?.created !== true &&
      out.rows.length === 0,
    `status=${out.parsed?.status} rows=${out.rows.length} hint=${json(out.parsed?.hint ?? null)}`,
  );
}

/* 16d. An update MERGES into the stored attributes: the untouched key survives
 *      and only the changed key is recorded in history. */
{
  const out = await run(updateProductTool, { productName: "Blue Suit", color: "Maroon" }, {
    setup: asClothingShop,
    runContext: clothingRunContext(),
  });
  asRetailShop();
  const row = onlyRow(out.rows);
  check(
    "update_product (new fields) an attribute change merges and never wipes the other keys",
    out.parsed?.status === "ok" &&
      json(out.parsed?.product?.attributes) === json({ fabric: "Cotton", color: "Maroon" }),
    json(out.parsed?.product?.attributes ?? null),
  );
  check(
    "update_product (new fields) history holds ONLY the changed attribute key",
    out.rows.length === 1 &&
      json(row?.before) === json({ "attributes.color": "Black" }) &&
      json(row?.after) === json({ "attributes.color": "Maroon" }),
    json({ before: row?.before, after: row?.after }),
  );
}

/* 16e. Removal is explicit and touches only the named key. */
{
  const out = await run(updateProductTool, { productName: "Blue Suit", clear_attributes: ["color"] }, {
    setup: asClothingShop,
    runContext: clothingRunContext(),
  });
  asRetailShop();
  const row = onlyRow(out.rows);
  check(
    "update_product (new fields) clear_attributes removes ONLY the named key",
    out.parsed?.status === "ok" &&
      json(out.parsed?.product?.attributes) === json({ fabric: "Cotton" }),
    json(out.parsed?.product?.attributes ?? null),
  );
  check(
    "update_product (new fields) a removed key shows as null on the after side of history",
    out.rows.length === 1 &&
      json(row?.before) === json({ "attributes.color": "Black" }) &&
      json(row?.after) === json({ "attributes.color": null }),
    json({ before: row?.before, after: row?.after }),
  );
}

/* 16f. A business type without the capability gets an honest failure, not a
 *      silent ignore. The stored fixture is left exactly as it was. */
{
  const before = json(CLOTHING_PRODUCT.attributes);
  const out = await run(updateProductTool, { productName: "Black Kurta", color: "Red" }, {
    setup: () => {
      serviceState.business = BUSINESS;
      serviceState.products = {
        ok: true,
        data: [{ ...PRODUCT, attributes: { fabric: "Cotton" }, unit: "Meter" }],
      };
    },
  });
  serviceState.products = { ok: true, data: [PRODUCT] };
  check(
    "update_product (new fields) a non-clothing business type rejects an attribute with a clear message",
    out.parsed?.status === "error" &&
      /not supported for this business type/.test(String(out.parsed?.hint ?? "")) &&
      out.rows.length === 0,
    `status=${out.parsed?.status} rows=${out.rows.length} hint=${json(out.parsed?.hint ?? null)}`,
  );
  check(
    "update_product (new fields) the rejected change leaves the stored record untouched",
    json({ fabric: "Cotton" }) === before || before === json({ fabric: "Cotton", color: "Black" }),
    `fixture=${before}`,
  );
}

/* 16g. The unit label is canonicalised on update, and a negative cost price is
 *      rejected with a readable reason. */
{
  const out = await run(updateProductTool, { productName: "Blue Suit", unit: "  yard " }, {
    setup: asClothingShop,
    runContext: clothingRunContext(),
  });
  asRetailShop();
  check(
    "update_product (new fields) the unit label is canonicalised on update",
    out.parsed?.status === "ok" && out.parsed?.product?.unit === "Yard",
    `unit=${json(out.parsed?.product?.unit ?? null)}`,
  );
}
{
  const out = await run(
    updateProductTool,
    { productName: "Blue Suit", cost_price: -5 },
    { setup: asClothingShop, runContext: clothingRunContext() },
  );
  asRetailShop();
  check(
    "update_product (new fields) a negative cost price is rejected with a clear message, no audit row",
    out.parsed?.status === "error" &&
      /Cost price cannot be negative/.test(String(out.parsed?.hint ?? "")) &&
      out.rows.length === 0,
    `status=${out.parsed?.status} rows=${out.rows.length} hint=${json(out.parsed?.hint ?? null)}`,
  );
}

/* 16h. An edit that changes nothing new writes no row — including a re-sent
 *      attribute value that is identical to the stored one. */
{
  const out = await run(updateProductTool, { productName: "Blue Suit", color: "black", unit: "piece" }, {
    setup: asClothingShop,
    runContext: clothingRunContext(),
  });
  asRetailShop();
  check(
    "update_product (new fields) re-sending identical attribute/unit values writes no audit row",
    out.parsed?.status === "ok" && out.rows.length === 0,
    `status=${out.parsed?.status} rows=${out.rows.length}`,
  );
}

/* 16i. Read tools report the new fields so the AI can state them truthfully. */
{
  const out = await run(findProductTool, { query: "Blue Suit" }, { setup: asClothingShop, runContext: clothingRunContext() });
  asRetailShop();
  const product = out.parsed?.product ?? {};
  check(
    "find_product returns attributes, unit and cost_price (and a unit-labelled quantity)",
    out.parsed?.status === "ok" &&
      json(product.attributes) === json({ fabric: "Cotton", color: "Black" }) &&
      product.unit === "Piece" &&
      product.cost_price === null &&
      product.stock_with_unit === "12 Piece",
    json(product),
  );
}
{
  const out = await run(listProductsTool, {}, { setup: asClothingShop, runContext: clothingRunContext() });
  asRetailShop();
  const product = out.parsed?.products?.[0] ?? {};
  check(
    "list_products returns attributes, unit and cost_price",
    out.parsed?.status === "ok" &&
      json(product.attributes) === json({ fabric: "Cotton", color: "Black" }) &&
      product.unit === "Piece" &&
      "cost_price" in product,
    json(product),
  );
}
{
  const out = await run(lowStockTool, {}, {
    setup: () => {
      serviceState.business = CLOTHING_BUSINESS;
      serviceState.products = {
        ok: true,
        data: [{ ...CLOTHING_PRODUCT, stockQuantity: 3, unit: "Meter" }],
      };
    },
    runContext: clothingRunContext(),
  });
  asRetailShop();
  const product = out.parsed?.products?.[0] ?? {};
  check(
    "low_stock_products reports the quantity with its unit and the attributes",
    out.parsed?.status === "ok" &&
      product.stock_with_unit === "3 Meter" &&
      product.unit === "Meter" &&
      json(product.attributes) === json({ fabric: "Cotton", color: "Black" }),
    json(product),
  );
}

/* 16k. The SAME stored attributes, read under a business type WITHOUT the
 *      capability: the model must not be shown clothing vocabulary the owner no
 *      longer has, while the unit and the cost price keep coming through. */
{
  const out = await run(findProductTool, { query: "Blue Suit" }, {
    setup: () => {
      serviceState.business = CLOTHING_BUSINESS;
      serviceState.products = {
        ok: true,
        data: [{ ...CLOTHING_PRODUCT, unit: "Meter", costPrice: 900 }],
      };
    },
    runContext: runContext({ businessType: "grocery" }),
  });
  asRetailShop();
  const product = out.parsed?.product ?? {};
  check(
    "find_product hides attributes for a business type without the capability",
    out.parsed?.status === "ok" && json(product.attributes) === json({}),
    json(product),
  );
  check(
    "find_product still reports the unit and cost price (they are not attributes)",
    product.unit === "Meter" && product.cost_price === 900,
    `unit=${json(product.unit ?? null)} cost_price=${json(product.cost_price ?? null)}`,
  );
}

/* 16j. A hostile business_id in the same payload is still ignored: the new
 *      fields change nothing about who the row belongs to. */
{
  const out = await run(
    createProductTool,
    {
      name: "Hostile Kurta",
      category: "Kurta",
      price: 1000,
      color: "Red",
      unit: "Piece",
      cost_price: 400,
      businessId: HOSTILE_BUSINESS,
      business_id: HOSTILE_BUSINESS,
    },
    { setup: asClothingShop, runContext: clothingRunContext() },
  );
  asRetailShop();
  check(
    "create_product (new fields) business_id still comes from the run context, not model input",
    out.rows.length === 1 &&
      out.rows[0].business_id === CONTEXT_BUSINESS &&
      out.rows[0].business_id !== HOSTILE_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
}

/* ===========================================================================
 * 17. Removing a recorded cost price (docs/p5.txt)
 *
 * `clear_cost_price` is the ONLY way a saved cost price is erased. The tool must
 * never read a missing cost_price as "delete it", must refuse the contradiction
 * of setting and clearing at once, must work the same for every business type,
 * and must record exactly what it removed.
 * ========================================================================= */
const COSTED_PRODUCT = { ...PRODUCT, costPrice: 900, unit: "Meter" };

/** A shop (of any type) holding a product with a recorded cost price. */
function asCostedShop(businessType = "retail_shop") {
  serviceState.business = { ...BUSINESS, businessType };
  serviceState.products = { ok: true, data: [COSTED_PRODUCT] };
}

/* 17a. The explicit removal erases the cost price and history shows the amount
 *      that is gone (never a fabricated replacement). */
{
  const out = await run(updateProductTool, { productName: "Black Kurta", clear_cost_price: true }, {
    setup: asCostedShop,
  });
  asRetailShop();
  const row = onlyRow(out.rows);
  const problems = expectAuditShape(row, {
    action: "product.update",
    entity: "product",
    entityId: PRODUCT.id,
    before: { cost_price: 900 },
    after: { cost_price: null },
  });
  check(
    "update_product (clear cost) clear_cost_price erases the saved cost price",
    out.parsed?.status === "ok" && out.parsed?.product?.cost_price === null,
    `status=${out.parsed?.status} cost_price=${json(out.parsed?.product?.cost_price ?? null)}`,
  );
  check(
    "update_product (clear cost) history records the removed amount as before -> null after",
    out.rows.length === 1 && problems.length === 0,
    problems.join(", ") || `rows=${out.rows.length}`,
  );
}

/* 17b. Nothing to remove: a product that never had a cost price changes
 *      nothing, so NO history row is written for a change that never happened. */
{
  const out = await run(updateProductTool, { productName: "Blue Suit", clear_cost_price: true }, {
    setup: () => {
      serviceState.business = CLOTHING_BUSINESS;
      serviceState.products = { ok: true, data: [CLOTHING_PRODUCT] };
    },
    runContext: clothingRunContext(),
  });
  asRetailShop();
  check(
    "update_product (clear cost) clearing a cost price that was never recorded is a no-op with no audit row",
    out.parsed?.status === "ok" && out.parsed?.product?.cost_price === null && out.rows.length === 0,
    `status=${out.parsed?.status} rows=${out.rows.length} cost_price=${json(out.parsed?.product?.cost_price ?? null)}`,
  );
}

/* 17c. "Set this amount" and "delete the saved amount" together cannot both be
 *      what the user meant — neither is executed and history stays empty. */
{
  const out = await run(
    updateProductTool,
    { productName: "Black Kurta", cost_price: 500, clear_cost_price: true },
    { setup: asCostedShop },
  );
  asRetailShop();
  check(
    "update_product (clear cost) setting and clearing the cost price at once fails with no audit row",
    out.parsed?.status === "error" &&
      /which one they mean/.test(String(out.parsed?.hint ?? "")) &&
      out.rows.length === 0,
    `status=${out.parsed?.status} rows=${out.rows.length} hint=${json(out.parsed?.hint ?? null)}`,
  );
}

/* 17d. An edit that says nothing about the cost price leaves it alone — the
 *      stored 900 comes back, and history does not mention it. */
{
  const out = await run(updateProductTool, { productName: "Black Kurta", price: 1600 }, {
    setup: asCostedShop,
  });
  asRetailShop();
  const row = onlyRow(out.rows);
  check(
    "update_product (clear cost) an edit that omits the cost price keeps it and records nothing about it",
    out.parsed?.status === "ok" &&
      out.parsed?.product?.cost_price === 900 &&
      out.rows.length === 1 &&
      json(row?.before) === json({ price: 1500 }) &&
      json(row?.after) === json({ price: 1600 }),
    `cost_price=${json(out.parsed?.product?.cost_price ?? null)} before=${json(row?.before ?? null)}`,
  );
}

/* 17e. Business-type independence: a cost price is a commercial fact every
 *      type owns, so erasing it works identically outside a clothing shop. */
{
  const types = ["electronics", "retail_shop", "grocery", "services", "restaurant_food", "other"];
  const failures = [];
  for (const businessType of types) {
    const out = await run(
      updateProductTool,
      { productName: "Black Kurta", clear_cost_price: true },
      { setup: () => asCostedShop(businessType) },
    );
    if (out.parsed?.status !== "ok" || out.parsed?.product?.cost_price !== null) {
      failures.push(`${businessType}: status=${out.parsed?.status}`);
    }
    if (out.rows.length !== 1) {
      failures.push(`${businessType}: rows=${out.rows.length}`);
    }
    asRetailShop();
  }
  check(
    "update_product (clear cost) every non-clothing business type can erase a cost price too",
    failures.length === 0,
    failures.join(" | ") || types.join(", "),
  );
}

/* 17f. A hostile business_id riding along with the removal changes nothing. */
{
  const out = await run(
    updateProductTool,
    {
      productName: "Black Kurta",
      clear_cost_price: true,
      businessId: HOSTILE_BUSINESS,
      business_id: HOSTILE_BUSINESS,
    },
    { setup: asCostedShop },
  );
  asRetailShop();
  check(
    "update_product (clear cost) the row is still audited against the run context's business",
    out.rows.length === 1 &&
      out.rows[0].business_id === CONTEXT_BUSINESS &&
      out.rows[0].business_id !== HOSTILE_BUSINESS,
    `business_id=${out.rows[0]?.business_id}`,
  );
  expectNoPersonalLeak(out.rows, "update_product (clear cost)");
}

/* ---------------------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------------------ */
const failed = results.filter((r) => !r.passed);
console.log("\n===== SUMMARY =====");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
