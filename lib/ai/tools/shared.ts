import "server-only";

import { z } from "zod";
import type { RunContext } from "@openai/agents-core";

import type { AgentRunContext } from "@/lib/ai/context";
import type {
  CustomerWithStats,
} from "@/lib/customers/types";
import type { Expense } from "@/lib/expenses/types";
import type { Product } from "@/lib/products/types";

/**
 * Shared plumbing for the AI Business Manager's controlled tools.
 *
 * Every tool is a thin, defensive wrapper over the existing business service
 * layer (which already enforces authentication, ownership and validation).
 * Tools receive model arguments as UNTRUSTED input, resolve entities only
 * within the caller's own business, and return compact JSON strings for the
 * model to explain honestly.
 */

/** Context accessor for tool execute functions. */
export function agentCtx(runContext: RunContext<AgentRunContext> | undefined): AgentRunContext {
  const context = runContext?.context;
  if (!context || typeof context !== "object" || !("businessId" in context)) {
    throw new Error("agent_context_missing");
  }
  return context;
}

/* ---------------------------------------------------------------------------
 * Structured tool outputs (JSON strings consumed by the model)
 * ------------------------------------------------------------------------ */

export function toolOk(data: Record<string, unknown>): string {
  // `status` is a RESERVED sentinel the route relies on (=== "ok") to mark a
  // confirmed success. It MUST come after the spread so a tool's own data can
  // never clobber it (e.g. update_order_status passing `status: "completed"`
  // used to overwrite this, flipping the pill to "failed" on a real success).
  return JSON.stringify({ ...data, status: "ok" });
}

export function toolFail(reason: string, hint: string): string {
  return JSON.stringify({ reason, hint, status: "error" });
}

/**
 * A non-completion result: the tool deliberately did NOT perform the requested
 * action and instead needs the user to clarify (e.g. multiple ambiguous
 * matches, or a validation problem that blocks creation). This must NOT use
 * `toolOk` — the chat UI treats `status: "ok"` as a confirmed success and would
 * otherwise show a false green checkmark on a non-completion.
 */
export function toolClarify(data: Record<string, unknown>): string {
  return JSON.stringify({ ...data, status: "needs_clarification" });
}

/**
 * Destructive/consequential operations must be confirmed by the user first.
 * The tool refuses to run until `confirmed` is true and instead returns a
 * summary the agent should present to the user as a yes/no question.
 */
export function toolNeedsConfirmation(
  summary: string,
  questionEn: string,
  questionUr: string,
): string {
  return JSON.stringify({
    summary,
    ask_user_en: questionEn,
    ask_user_ur: questionUr,
    status: "needs_confirmation",
  });
}

/* ---------------------------------------------------------------------------
 * Model-facing schemas (zod) — kept deliberately small and flat
 * ------------------------------------------------------------------------ */

export const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable();

export const limitSchema = (def: number, max: number) =>
  z.number().int().min(1).max(max).optional().default(def);

/**
 * Merge helper for update tools. The model frequently sends `null` for fields
 * it is NOT changing (e.g. `email: null` when the user only asked to change the
 * phone). Treating an explicit `null` as "set to null" silently wiped unrelated
 * fields (data-loss bug). So: only apply a change when the incoming value is
 * non-null (and defined); `null` means "leave the existing value untouched".
 * Pass an empty string if a field must genuinely be cleared.
 */
export const orKeep = <T>(
  value: T | null | undefined,
  fallback: T,
): T => (value !== undefined && value !== null ? value : fallback);


/* ---------------------------------------------------------------------------
 * Name-based entity resolution (never trust ids from the model)
 * ------------------------------------------------------------------------ */

function normalize(value: string): string {
  return value
    // Strip wrapping quotes/punctuation that models sometimes add.
    .replace(/^["'«»“”‘’`*_]+|["'«»“”‘’`*_]+$/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export interface ResolutionMatch<T> {
  item: T;
}

export type ResolutionResult<T> =
  | { kind: "found"; item: T }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidates: T[] };

/**
 * Resolves an entity by name/sku/number against a list from THIS business
 * only. Exact normalized match wins; otherwise unique substring match;
 * otherwise ambiguous with the closest candidates for clarification.
 */
export function resolveByQuery<T>(
  query: string,
  items: T[],
  keysOf: (item: T) => string[],
): ResolutionResult<T> {
  const needle = normalize(query);
  if (!needle) return { kind: "not_found" };

  const exact = items.filter((item) =>
    keysOf(item).some((key) => normalize(key) === needle),
  );
  if (exact.length === 1) return { kind: "found", item: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };

  const partial = items.filter((item) =>
    keysOf(item).some((key) => normalize(key).includes(needle)),
  );
  if (partial.length === 1) return { kind: "found", item: partial[0] };
  if (partial.length > 1) {
    // Prefer the shortest names as most relevant candidates.
    const sorted = [...partial].sort((a, b) => {
      const aLen = Math.min(...keysOf(a).map((k) => k.length));
      const bLen = Math.min(...keysOf(b).map((k) => k.length));
      return aLen - bLen;
    });
    return { kind: "ambiguous", candidates: sorted.slice(0, 5) };
  }
  return { kind: "not_found" };
}

const PRODUCT_KEYS = (product: Product) =>
  [product.name, product.sku ?? "", product.category];

export function resolveProduct(
  query: string,
  products: Product[],
): ResolutionResult<Product> {
  return resolveByQuery(query, products, PRODUCT_KEYS);
}

const CUSTOMER_KEYS = (customer: CustomerWithStats) =>
  [customer.name, customer.phone ?? "", customer.email ?? ""];

export function resolveCustomer(
  query: string,
  customers: CustomerWithStats[],
): ResolutionResult<CustomerWithStats> {
  return resolveByQuery(query, customers, CUSTOMER_KEYS);
}

const EXPENSE_KEYS = (expense: Expense) => [expense.title];

export function resolveExpense(
  query: string,
  expenses: Expense[],
): ResolutionResult<Expense> {
  return resolveByQuery(query, expenses, EXPENSE_KEYS);
}

/**
 * Resolves an entity directly by its stable database ID, bypassing name-based
 * search entirely. Used when a tool already returned candidate IDs earlier in
 * the conversation and the user then picks one by position ("pehla / first")
 * or by an attribute ("clothing wala") the agent itself mentioned. This lets
 * the agent target the EXACT record instead of re-running an ambiguous search.
 *
 * The ID comes from the tool's own earlier output (which the agent can re-read
 * in context) — it is still validated against the caller's own business list,
 * so a guessed or foreign ID safely resolves to null.
 */
export function findById<T extends { id: string }>(
  items: T[],
  id: string,
): T | null {
  if (!id) return null;
  const found = items.find((item) => item.id === id) ?? null;
  // Diagnostic (docs/fix.txt §point 3): hard evidence of what an id lookup
  // actually searched for and returned, so a "record not found" can be traced
  // to either a genuinely missing id or a wrong/truncated id the model sent.
  console.log(
    "[disambiguation] findById -> searched id:",
    JSON.stringify(id),
    "| available ids (first 6):",
    JSON.stringify(items.slice(0, 6).map((i) => i.id)),
    "| resolved:",
    found ? "FOUND" : "NOT_FOUND",
    found ? `(id=${found.id})` : "",
  );
  return found;
}
