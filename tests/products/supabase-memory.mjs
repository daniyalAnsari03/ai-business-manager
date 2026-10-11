/**
 * In-memory stand-in for the server-side Supabase client, just complete enough
 * for the REAL lib/products/service.ts to run offline.
 *
 * It mirrors the parts of PostgREST the product service actually depends on:
 * the `.select().eq().eq().order()` read chain, `.insert().select().single()`,
 * `.update(patch).eq().eq().select().single()`, `.select(cols).maybeSingle()`
 * and the PGRST116 "zero rows" error a `.single()` returns when a scoped update
 * matched nothing. Money columns come back as STRINGS (numeric in Postgres),
 * and rows that predate the attributes/unit/cost_price columns simply have no
 * such keys — the same shape the service sees in production.
 *
 * Anything the service does NOT use in this suite (search filters, RPCs) throws
 * loudly instead of silently doing nothing, so a check can never pass through
 * an unimplemented query.
 */

export const db = {
  /** The session's business: the only business these calls can ever touch. */
  businessId: "11111111-1111-4111-8111-111111111111",
  /** A second business, present to prove the service never reaches across. */
  otherBusinessId: "99999999-9999-4999-8999-999999999999",
  /** Switched per case (e.g. from clothing_fashion to grocery). */
  businessType: "clothing_fashion",
  products: [],
  /** Every statement that reached the "database", for assertions. */
  writes: [],
  nextId: 1,
};

/** A product row exactly as the products table stores it. */
export function productRow(overrides = {}) {
  const id = overrides.id ?? `product-${db.nextId++}`;
  return {
    id,
    business_id: db.businessId,
    name: "Blue Suit",
    description: null,
    category: "Suits",
    price: "4200.00",
    stock_quantity: 12,
    low_stock_threshold: 5,
    sku: null,
    image_url: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Resets the whole world between cases. */
export function resetDb({ businessType = "clothing_fashion", products = [] } = {}) {
  db.businessType = businessType;
  db.products = products;
  db.writes = [];
  db.nextId = 1;
}

const NO_ROWS = () => ({ data: null, error: { code: "PGRST116", message: "0 rows" } });

class ProductsQuery {
  constructor(mode) {
    this.mode = mode;
    this.payload = null;
    this.filters = [];
    this.ordering = null;
    this.selected = "*";
  }

  select(columns = "*") {
    this.selected = columns;
    return this;
  }

  insert(row) {
    this.mode = "insert";
    this.payload = row;
    return this;
  }

  update(patch) {
    this.mode = "update";
    this.payload = patch;
    return this;
  }

  eq(column, value) {
    this.filters.push([column, value]);
    return this;
  }

  ilike(column, value) {
    this.filters.push([column, value]);
    return this;
  }

  order(column, options) {
    this.ordering = [column, options];
    return this;
  }

  or() {
    throw new Error("product-service test stub: .or() search filtering is not implemented in this suite");
  }

  limit() {
    throw new Error("product-service test stub: .limit() is not implemented in this suite");
  }

  matches(row) {
    return this.filters.every(([column, value]) => row[column] === value);
  }

  project(row) {
    if (this.selected === "*") return { ...row };
    const out = {};
    for (const column of this.selected.split(",").map((part) => part.trim())) {
      if (column in row) out[column] = row[column];
    }
    return out;
  }

  run() {
    if (this.mode === "select") {
      const rows = db.products.filter((row) => this.matches(row));
      const ordered =
        this.ordering && this.ordering[1]?.ascending === false
          ? [...rows].sort((a, b) => String(b[this.ordering[0]]).localeCompare(String(a[this.ordering[0]])))
          : rows;
      return { data: ordered.map((row) => this.project(row)), error: null };
    }

    if (this.mode === "insert") {
      // NOT NULL DEFAULT behaviour of the real columns.
      const row = productRow({
        attributes: {},
        unit: "Piece",
        cost_price: null,
        ...this.payload,
      });
      db.products.push(row);
      db.writes.push({ op: "insert", row });
      return { data: [this.project(row)], error: null };
    }

    if (this.mode === "update") {
      const row = db.products.find((candidate) => this.matches(candidate));
      if (!row) return NO_ROWS();
      Object.assign(row, this.payload);
      row.updated_at = "2026-02-01T00:00:00.000Z";
      db.writes.push({ op: "update", id: row.id, patch: { ...this.payload } });
      return { data: [this.project(row)], error: null };
    }

    throw new Error(`product-service test stub: unsupported mode "${this.mode}"`);
  }

  single() {
    const { data, error } = this.run();
    if (error) return { data: null, error };
    return { data: data[0] ?? null, error: data[0] ? null : { code: "PGRST116", message: "0 rows" } };
  }

  maybeSingle() {
    const { data, error } = this.run();
    return { data: data[0] ?? null, error };
  }

  then(onFulfilled, onRejected) {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}

export const supabaseStub = {
  from(table) {
    if (table !== "products") {
      throw new Error(`product-service test stub: unexpected table "${table}"`);
    }
    return new ProductsQuery("select");
  },
  rpc() {
    throw new Error("product-service test stub: rpc() is not implemented in this suite");
  },
};
