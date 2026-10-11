import { state } from "./state.mjs";

/**
 * Deterministic in-memory Supabase stand-in for the offline service/tool tests.
 *
 * - `rpc(name, args)` results are scripted by the test through setRpc /
 *   setAdminRpc and every call is recorded (rpcCalls / adminRpcCalls) so tests
 *   can prove which RPC ran, with exactly which arguments.
 * - `from(table)` returns a chainable, awaitable query covering the SELECT /
 *   INSERT / UPDATE / DELETE shapes the real services use. Every query that
 *   carries an `eq("business_id", ...)` filter is recorded in `fromCalls` so
 *   tenant isolation can be asserted.
 * - `nextError` injects a PostgREST-style `{ code }` error on the following
 *   terminal op (used for SQLSTATE 23503/23505/PGRST116 paths).
 *
 * The builder is intentionally small (no .or() filtering truth, no aggregates);
 * tests that need search semantics are covered at tool level with stubbed
 * read services instead.
 */
export function projectRow(row, selectCols) {
  if (!selectCols || selectCols === "*") return row;
  const out = {};
  for (const name of String(selectCols).split(",").map((s) => s.trim()).filter(Boolean)) {
    if (name in row) out[name] = row[name];
  }
  return out;
}

export function createFakeDb(seed = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) {
    tables.set(name, (rows ?? []).map((r) => ({ ...r })));
  }

  const db = {
    tables,
    rpcCalls: [],
    adminRpcCalls: [],
    fromCalls: [],
    nextError: null,
    rpcHandler: null,
    adminRpcHandler: null,
    setRpc(handler) {
      this.rpcHandler = handler;
    },
    setAdminRpc(handler) {
      this.adminRpcHandler = handler;
    },
  };

  function matches(row, filter) {
    switch (filter.op) {
      case "eq":
        return row[filter.col] === filter.value;
      case "in":
        return Array.isArray(filter.value) && filter.value.includes(row[filter.col]);
      case "not":
        return filter.value === null ? row[filter.col] !== null : row[filter.col] !== filter.value;
      case "lt":
        return row[filter.col] != null && row[filter.col] < filter.value;
      case "or":
        return true; // PostgREST or(); search fakes are covered by stub services.
      default:
        return true;
    }
  }

  function applyOrder(rows, orderCol, orderDesc) {
    return [...rows].sort((a, b) => {
      const av = a[orderCol];
      const bv = b[orderCol];
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : 1;
      return orderDesc ? -cmp : cmp;
    });
  }

  class Query {
    constructor(table, trace) {
      this.table = table;
      this.trace = trace;
      this.filters = [];
      this.orderCol = null;
      this.orderDesc = false;
      this.limitN = null;
      this.selectCols = "*";
      this.countMode = null;
      this.singleMode = null;
      this.op = "read";
      this.insertRow = null;
      this.patch = null;
    }

    select(cols, options) {
      this.selectCols = cols ?? "*";
      if (options && typeof options === "object") {
        this.countMode = options.count ?? null;
      }
      return this;
    }

    eq(col, value) {
      this.filters.push({ op: "eq", col, value });
      if (col === "business_id") this.trace.businessId = value;
      this.trace.eqFilters.push({ col, value });
      return this;
    }

    in(col, values) {
      this.filters.push({ op: "in", col, value: values });
      return this;
    }

    not(col, value) {
      this.filters.push({ op: "not", col, value });
      return this;
    }

    lt(col, value) {
      this.filters.push({ op: "lt", col, value });
      return this;
    }

    or() {
      this.filters.push({ op: "or", col: null, value: null });
      return this;
    }

    order(col, options) {
      this.orderCol = col;
      this.orderDesc = options && options.ascending === false;
      return this;
    }

    limit(n) {
      this.limitN = n;
      return this;
    }

    maybeSingle() {
      this.singleMode = "maybe";
      return this;
    }

    single() {
      this.singleMode = "single";
      return this;
    }

    insert(row) {
      this.op = "insert";
      this.insertRow = row;
      return this;
    }

    update(patch) {
      this.op = "update";
      this.patch = patch;
      return this;
    }

    delete() {
      this.op = "delete";
      return this;
    }

    _rows() {
      const all = db.tables.get(this.table) ?? [];
      return all.filter((row) => this.filters.every((f) => matches(row, f)));
    }

    _run() {
      if (db.nextError) {
        const injected = db.nextError;
        db.nextError = null;
        return {
          data: null,
          error: { code: injected.code ?? injected, message: injected.message ?? `injected ${injected.code ?? injected}` },
        };
      }

      if (this.op === "insert") {
        const row = { ...this.insertRow };
        if (!row.id) row.id = `row-${Math.random().toString(36).slice(2, 10)}`;
        const table = db.tables.get(this.table);
        if (table) table.push(row);
        else db.tables.set(this.table, [row]);
        if (this.countMode) return { data: null, error: null, count: 1 };
        return { data: projectRow(row, this.selectCols), error: null };
      }

      let rows = this._rows();
      if (this.orderCol) rows = applyOrder(rows, this.orderCol, this.orderDesc);
      if (this.limitN) rows = rows.slice(0, this.limitN);

      if (this.op === "update") {
        const updated = rows.map((row) => ({ ...row, ...this.patch }));
        for (const u of updated) {
          const table = db.tables.get(this.table) ?? [];
          const idx = table.findIndex((r) => r.id === u.id);
          if (idx >= 0) table[idx] = u;
        }
        if (this.countMode) return { data: null, error: null, count: updated.length };
        if (this.singleMode === "single") {
          return updated.length > 0
            ? { data: projectRow(updated[0], this.selectCols), error: null }
            : { data: null, error: { code: "PGRST116" } };
        }
        return { data: updated.map((r) => projectRow(r, this.selectCols)), error: null };
      }

      if (this.op === "delete") {
        const table = db.tables.get(this.table) ?? [];
        const ids = new Set(rows.map((r) => r.id));
        const remaining = table.filter((r) => !ids.has(r.id));
        db.tables.set(this.table, remaining);
        if (this.singleMode === "single") {
          return rows.length > 0
            ? { data: projectRow(rows[0], this.selectCols), error: null }
            : { data: null, error: { code: "PGRST116" } };
        }
        return { data: rows.map((r) => projectRow(r, this.selectCols)), error: null };
      }

      // read
      if (this.countMode) return { data: null, error: null, count: rows.length };
      if (this.singleMode === "single") {
        if (rows.length === 1) return { data: projectRow(rows[0], this.selectCols), error: null };
        if (rows.length > 1) return { data: null, error: { code: "PGRST116", details: "more than one row" } };
        return { data: null, error: { code: "PGRST116" } };
      }
      if (this.singleMode === "maybe") {
        return { data: rows.length > 0 ? projectRow(rows[0], this.selectCols) : null, error: null };
      }
      return { data: rows.map((r) => projectRow(r, this.selectCols)), error: null };
    }

    then(resolve, reject) {
      Promise.resolve().then(() => {
        try {
          resolve(this._run());
        } catch (error) {
          reject(error);
        }
      });
    }
  }

  function makeFrom(client, table) {
    const trace = { table, client, businessId: null, eqFilters: [], mutate: false };
    db.fromCalls.push(trace);
    const query = new Query(table, trace);
    const origMutation = query.insert.bind(query);
    query.insert = (row) => {
      trace.mutate = true;
      return origMutation(row);
    };
    return query;
  }

  db.makeFrom = (client, table) => makeFrom(client, table);
  db.from = (table) => makeFrom("server", table);
  db.rpc = (name, args) => {
    db.rpcCalls.push({ name, args });
    if (db.rpcHandler) return db.rpcHandler(name, args, db);
    return Promise.resolve({ data: null, error: null });
  };

  return db;
}

function currentDb() {
  return state.db ?? createFakeDb();
}

export async function getSupabaseServerClient() {
  return currentDb();
}

export async function getSupabaseAdminClient() {
  const db = currentDb();
  if (db.nextAdminUnavailable) return null;
  return {
    from(table) {
      return db.makeFrom("admin", table);
    },
    rpc(name, args) {
      db.adminRpcCalls.push({ name, args });
      if (db.adminRpcHandler) return db.adminRpcHandler(name, args, db);
      return Promise.resolve({ data: null, error: null });
    },
  };
}

export async function getServerUser() {
  if (state.user === null) return null;
  return (
    state.user ?? { id: state.business?.ownerId ?? "stub-user", email: null, user_metadata: {} }
  );
}