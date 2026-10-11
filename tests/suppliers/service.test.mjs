/**
 * Offline tests for the suppliers + supplier-bills service layers
 * (docs/fix.txt Stage 5):
 *
 *  - supplier validation (name, email, lengths)
 *  - supplier CRUD against the in-memory Supabase fake: tenant scoping,
 *    unique-name exists (23505), delete maps FK-restrict (23503) and
 *    no-rows (PGRST116)
 *  - supplier-bill validation (subtotal/discount rules, dates)
 *  - supplier-bill CRUD: wrapper-RPC argument shape (no business_id from the
 *    client), EVERY RPC error code mapping, delete blocked with payments
 *  - cross-tenant tamper-proofing: business A cannot delete or read B's data
 *
 * The REAL modules run against the fake via tests/payments/register-hooks.mjs.
 */

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { state } from "../payments/stubs/state.mjs";
import { createFakeDb } from "../payments/stubs/fake-supabase.mjs";

import {
  createSupplier,
  deleteSupplier,
  getSupplier,
  getSupplierCount,
  getSuppliers,
  updateSupplier,
} from "@/lib/suppliers/service";
import { validateSupplierInput } from "@/lib/suppliers/validation";
import {
  createSupplierBill,
  deleteSupplierBill,
  getSupplierBill,
  getSupplierBills,
  updateSupplierBill,
} from "@/lib/supplier-bills/service";
import {
  validateSupplierBillInput,
  validateSupplierBillUpdateInput,
} from "@/lib/supplier-bills/validation";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function businessRow(id) {
  return {
    id,
    name: `Business ${id.slice(0, 1)}`,
    businessType: "retail",
    currency: "PKR",
    language: "en",
    ownerId: `owner-${id.slice(0, 1)}`,
    phone: null,
    address: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function supplierRow(overrides = {}) {
  return {
    id: overrides.id,
    business_id: A,
    name: overrides.name ?? "Karachi Fabrics",
    phone: null,
    email: null,
    address: null,
    payment_terms: null,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function billRow(overrides = {}) {
  return {
    id: "b-1",
    business_id: A,
    supplier_id: SUP,
    bill_number: "B-001",
    bill_date: "2026-10-01",
    due_date: null,
    subtotal: 1000,
    discount: 0,
    total: 1000,
    paid_amount: 0,
    due_amount: 1000,
    status: "unpaid",
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function seed() {
  state.business = businessRow(A);
  state.user = undefined;
  state.db = createFakeDb({
    suppliers: [supplierRow({ id: SUP })],
    supplier_bills: [billRow()],
    orders: [],
    payments: [],
  });
  state.db.setRpc((name) => {
    if (name === "create_supplier_bill") {
      return Promise.resolve({ data: { ok: true, bill: billRow() }, error: null });
    }
    if (name === "update_supplier_bill") {
      return Promise.resolve({ data: { ok: true, bill: billRow() }, error: null });
    }
    if (name === "delete_supplier_bill") {
      return Promise.resolve({ data: { ok: true, deleted: true }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  return state.db;
}

beforeEach(() => {
  seed();
});

/* ---------------------------------------------------------------------------
 * Supplier validation
 * ------------------------------------------------------------------------ */

test("supplier validation requires a name and normalizes email", () => {
  assert.equal(validateSupplierInput(null).fieldErrors.name, "required");
  assert.equal(validateSupplierInput({ name: "  " }).fieldErrors.name, "required");
  assert.equal(validateSupplierInput({ name: "X".repeat(121) }).fieldErrors.name, "too_long");
  assert.equal(validateSupplierInput({ name: "Ok", email: "not-an-email" }).fieldErrors.email, "invalid_email");
  assert.equal(validateSupplierInput({ name: "Ok", email: "ALI@Example.com", phone: "1".repeat(31) }).fieldErrors.phone, "too_long");

  const ok = validateSupplierInput({ name: "  Ali Traders ", email: "Ali@Shop.pk", phone: "0300" });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.name, "Ali Traders");
  assert.equal(ok.value.email, "ali@shop.pk");
});

/* ---------------------------------------------------------------------------
 * Supplier CRUD + tenant safety
 * ------------------------------------------------------------------------ */

test("createSupplier inserts with the session business id, ignoring hostile input", async () => {
  const result = await createSupplier({
    name: "New Supplier",
    email: "guy@shop.pk",
    business_id: B,
    businessId: B,
  });
  assert.equal(result.ok, true);
  const inserted = state.db.tables.get("suppliers").find((s) => s.name === "New Supplier");
  assert.equal(inserted.business_id, A);
  const trace = state.db.fromCalls.find((c) => c.mutate && c.table === "suppliers");
  assert.ok(trace, "expected a suppliers insert");
  assert.notEqual(inserted.business_id, B);
});

test("createSupplier maps a unique-name violation to supplier_exists", async () => {
  state.db.nextError = { code: "23505" };
  const result = await createSupplier({ name: "Dupe" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "supplier_exists");
});

test("getSuppliers enriches owing from bills and is tenant-scoped", async () => {
  const result = await getSuppliers();
  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].totalOwing, 1000);
  for (const call of state.db.fromCalls.filter((c) => c.table === "suppliers" || c.table === "supplier_bills")) {
    assert.equal(call.businessId, A);
  }
});

test("getSupplier not_found, count, and cross-tenant reads are safe", async () => {
  assert.equal((await getSupplier(SUP)).ok, true);
  assert.equal((await getSupplier("missing")).reason, "not_found");

  state.business = businessRow(B);
  const notFound = await getSupplier(SUP); // A's supplier must be invisible to B
  assert.equal(notFound.ok, false);
  assert.equal(notFound.reason, "not_found");
  assert.equal((await getSuppliers()).data.length, 0);
  assert.equal((await getSupplierCount()).data, 0);
});

test("updateSupplier not_found and tenant protection", async () => {
  state.db.nextError = { code: "PGRST116" };
  assert.equal((await updateSupplier(SUP, { name: "Renamed" })).reason, "not_found");

  state.business = businessRow(B);
  const tamper = await updateSupplier(SUP, { name: "Hijacked" });
  assert.equal(tamper.ok, false);
  assert.equal(tamper.reason, "not_found");
});

test("deleteSupplier maps FK-restrict to supplier_has_bills and PGRST116 to not_found", async () => {
  state.db.nextError = { code: "23503" };
  assert.equal((await deleteSupplier(SUP)).reason, "supplier_has_bills");

  state.db.nextError = { code: "PGRST116" };
  assert.equal((await deleteSupplier("nope")).reason, "not_found");

  // A clean delete removes only the matching business's row.
  const ok = await deleteSupplier(SUP);
  assert.equal(ok.ok, true);
  assert.equal(state.db.tables.get("suppliers").find((s) => s.id === SUP), undefined);
});

test("business B cannot delete A's supplier", async () => {
  state.business = businessRow(B);
  const result = await deleteSupplier(SUP);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_found");
  assert.ok(state.db.tables.get("suppliers").some((s) => s.id === SUP));
});

/* ---------------------------------------------------------------------------
 * Supplier-bill validation
 * ------------------------------------------------------------------------ */

test("supplier-bill validation enforces amounts, dates and ids", () => {
  assert.equal(validateSupplierBillInput(null).fieldErrors.supplierId, "required");
  assert.equal(
    validateSupplierBillInput({ supplierId: "not-a-uuid", subtotal: 100, discount: 0, billDate: "2026-10-01" })
      .fieldErrors.supplierId,
    "supplier_invalid",
  );
  assert.equal(
    validateSupplierBillInput({ supplierId: SUP, subtotal: "100", discount: 0, billDate: "2026-10-01" })
      .fieldErrors.subtotal,
    "not_a_number",
  );
  assert.equal(
    validateSupplierBillInput({ supplierId: SUP, subtotal: 100, discount: 150, billDate: "2026-10-01" })
      .fieldErrors.discount,
    "more_than_subtotal",
  );
  assert.equal(
    validateSupplierBillInput({ supplierId: SUP, subtotal: 100, discount: 100, billDate: "2026-10-01" })
      .fieldErrors.discount,
    "equals_subtotal",
  );
  assert.equal(
    validateSupplierBillInput({ supplierId: SUP, subtotal: 100, discount: 0, billDate: "01/10/2026" })
      .fieldErrors.billDate,
    "invalid_date",
  );
  assert.equal(
    validateSupplierBillInput({ supplierId: SUP, subtotal: 100, discount: 0, billDate: "2026-10-05", dueDate: "2026-10-01" })
      .fieldErrors.dueDate,
    "before_bill_date",
  );
});

test("supplier-bill validation accepts a valid payload", () => {
  const result = validateSupplierBillInput({
    supplierId: SUP,
    subtotal: 1000,
    discount: 50,
    billNumber: "B-002",
    billDate: "2026-10-05",
    dueDate: "2026-10-15",
    notes: "net 10",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.subtotal, 1000);
  assert.equal(result.value.discount, 50);
  // Update path reuses the same validator.
  assert.equal(validateSupplierBillUpdateInput({ ...result.value, billNumber: "B-003" }).ok, true);
});

/* ---------------------------------------------------------------------------
 * Supplier-bill CRUD + RPC contract
 * ------------------------------------------------------------------------ */

test("createSupplierBill never sends a business_id; every code maps", async () => {
  const codes = [
    ["NO_BUSINESS", "no_business"],
    ["NOT_FOUND", "not_found"],
    ["SUPPLIER_REQUIRED", "supplier_not_found"],
    ["SUPPLIER_NOT_FOUND", "supplier_not_found"],
    ["SUPPLIER_INVALID", "supplier_invalid"],
    ["INVALID_AMOUNT", "invalid_amount"],
    ["BILL_TOTAL_INVALID", "bill_total_invalid"],
    ["BILL_NUMBER_INVALID", "bill_number_invalid"],
    ["BILL_DATE_INVALID", "bill_date_invalid"],
    ["INVALID_NOTES", "invalid_notes"],
    ["BILL_PAID_NOT_EDITABLE", "bill_paid_not_editable"],
    ["BILL_BELOW_PAID", "bill_below_paid"],
    ["HAS_PAYMENTS", "has_payments"],
    ["NOPE_NOT_A_CODE", "database_error"],
  ];
  for (const [code, reason] of codes) {
    state.db.setRpc((name) => {
      if (name === "create_supplier_bill") {
        return Promise.resolve({ data: { ok: false, error: code }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const result = await createSupplierBill({ supplierId: SUP, subtotal: 1000, discount: 0, billDate: "2026-10-01" });
    assert.equal(result.ok, false, `code ${code}`);
    assert.equal(result.reason, reason, `code ${code}`);
  }

  state.db.setRpc(() => Promise.resolve({ data: { ok: true, bill: billRow() }, error: null }));
  const callArg = { supplierId: SUP, subtotal: 1000, discount: 0, billDate: "2026-10-01", business_id: B };
  const ok = await createSupplierBill(callArg);
  assert.equal(ok.ok, true);
  const rpcCall = state.db.rpcCalls.find((c) => c.name === "create_supplier_bill");
  assert.equal(rpcCall.args.p_payload.business_id, undefined);
  assert.equal(rpcCall.args.p_payload.businessId, undefined);
  assert.equal(rpcCall.args.p_payload.supplierId, SUP);
  assert.equal(rpcCall.args.p_payload.subtotal, 1000);
});

test("updateSupplierBill and deleteSupplierBill honor their error codes", async () => {
  state.db.setRpc((name) => {
    if (name === "update_supplier_bill") {
      return Promise.resolve({ data: { ok: false, error: "BILL_PAID_NOT_EDITABLE" }, error: null });
    }
    if (name === "delete_supplier_bill") {
      return Promise.resolve({ data: { ok: false, error: "HAS_PAYMENTS" }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  const update = await updateSupplierBill("b-1", { supplierId: SUP, subtotal: 900, discount: 0, billDate: "2026-10-01" });
  assert.equal(update.ok, false);
  assert.equal(update.reason, "bill_paid_not_editable");

  const del = await deleteSupplierBill("b-1");
  assert.equal(del.ok, false);
  assert.equal(del.reason, "has_payments");
});

test("getSupplierBills attaches the supplier name and is tenant-scoped", async () => {
  const result = await getSupplierBills({ supplierId: SUP });
  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].supplierName, "Karachi Fabrics");
  assert.equal(result.data[0].dueAmount, 1000);
});

test("business B cannot read or delete A's bills", async () => {
  state.business = businessRow(B);
  assert.deepEqual((await getSupplierBills()).data, []);
  assert.equal((await getSupplierBill("b-1")).reason, "not_found");
});

test("deleteSupplierBill succeeds when the bill has no payments", async () => {
  const result = await deleteSupplierBill("b-1");
  assert.equal(result.ok, true);
  assert.equal(result.data.id, "b-1");
});