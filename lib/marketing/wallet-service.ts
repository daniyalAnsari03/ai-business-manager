import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import type { WalletTransaction } from "@/lib/marketing/types";

/**
 * Wallet service — the ONLY place that talks to Supabase about wallet
 * transactions. Ownership is always derived from the authenticated
 * server-side session (user → owned business → row.business_id); RLS is
 * the second enforcement layer.
 *
 * All mutation functions use RPC functions defined in the migration so
 * the balance update and ledger insert happen atomically — no partial
 * state is ever possible.
 */

export type WalletServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "insufficient_balance"
  | "wallet_not_found"
  | "transaction_not_found"
  | "database_error";

export type WalletServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: WalletServiceError };

/** Resolves the caller's session + owned business, or a failure reason. */
async function requireBusinessContext(): Promise<
  | { ok: true; supabase: SupabaseClient; business: Business }
  | { ok: false; reason: WalletServiceError }
> {
  let user;
  let supabase: SupabaseClient;
  try {
    user = await getServerUser();
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }
  if (!user) return { ok: false, reason: "unauthenticated" };

  const business = await getUserBusiness();
  if (!business) return { ok: false, reason: "no_business" };
  return { ok: true, supabase, business };
}

/**
 * Resolve the business ID from the authenticated session. Used by server
 * actions that need the business ID without exposing it to the client.
 */
export async function resolveBusinessId(): Promise<
  WalletServiceResult<string>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;
  return { ok: true, data: context.business.id };
}

function toNumber(value: string | number | null): number {
  if (value === null) return 0;
  return typeof value === "number" ? value : Number.parseFloat(value) || 0;
}

interface WalletTransactionRow {
  id: string;
  business_id: string;
  type: string;
  amount: string | number;
  balance_after: string | number;
  gateway_reference: string | null;
  description: string | null;
  status: string;
  created_at: string;
}

function mapTransaction(row: WalletTransactionRow): WalletTransaction {
  return {
    id: row.id,
    businessId: row.business_id,
    type: row.type as WalletTransaction["type"],
    amount: toNumber(row.amount),
    balanceAfter: toNumber(row.balance_after),
    gatewayReference: row.gateway_reference,
    description: row.description,
    status: row.status as WalletTransaction["status"],
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Recent wallet transactions for the caller's business, ordered newest
 * first. Defaults to 50 rows; pass a smaller limit for compact views.
 */
export async function getWalletTransactions(
  limit = 50,
): Promise<WalletServiceResult<WalletTransaction[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("wallet_transactions")
    .select("*")
    .eq("business_id", context.business.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { ok: false, reason: "database_error" };

  const transactions = ((data ?? []) as WalletTransactionRow[]).map(
    mapTransaction,
  );

  return { ok: true, data: transactions };
}

/**
 * Current wallet balance. Creates the wallet row with balance 0 if it
 * doesn't exist yet (idempotent — the row is only created once).
 */
export async function getWalletBalance(): Promise<
  WalletServiceResult<{ balance: number; walletId: string | null }>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("marketing_wallet")
    .select("id, balance")
    .eq("business_id", context.business.id)
    .maybeSingle();

  if (error) return { ok: false, reason: "database_error" };

  if (!data) {
    return { ok: true, data: { balance: 0, walletId: null } };
  }

  return {
    ok: true,
    data: {
      balance: toNumber(data.balance),
      walletId: data.id,
    },
  };
}

// ---------------------------------------------------------------------------
// Write operations (all use RPC for atomicity)
// ---------------------------------------------------------------------------

/**
 * Atomically increase wallet balance and insert a completed topup ledger
 * row. Called by the payment provider callback after successful payment.
 *
 * No fake/mock topups — this is only called with a real gateway reference
 * from a verified payment provider session.
 *
 * An optional `supabaseAdmin` client can be passed for webhook contexts
 * where the service-role key bypasses RLS (no user session available).
 */
export async function completeTopup(
  input: {
    businessId: string;
    amount: number;
    gatewayReference: string;
    description?: string;
  },
  supabaseAdmin?: SupabaseClient,
): Promise<
  WalletServiceResult<{
    transactionId: string;
    newBalance: number;
  }>
> {
  if (input.amount <= 0) {
    return { ok: false, reason: "invalid_input" };
  }

  let supabase: SupabaseClient;
  if (supabaseAdmin) {
    supabase = supabaseAdmin;
  } else {
    try {
      supabase = await getSupabaseServerClient();
    } catch {
      return { ok: false, reason: "not_configured" };
    }
  }

  const { data, error } = await supabase.rpc("process_wallet_topup", {
    p_business_id: input.businessId,
    p_amount: input.amount,
    p_gateway_reference: input.gatewayReference,
    p_description: input.description ?? null,
  });

  if (error || !data) return { ok: false, reason: "database_error" };

  const result = data as {
    transaction_id: string;
    new_balance: string | number;
  };

  return {
    ok: true,
    data: {
      transactionId: result.transaction_id,
      newBalance: toNumber(result.new_balance),
    },
  };
}

/**
 * Atomically deduct from wallet balance and insert a completed spend
 * ledger row. Fails if insufficient funds.
 */
export async function processSpend(input: {
  businessId: string;
  amount: number;
  description?: string;
}): Promise<
  WalletServiceResult<{
    transactionId: string;
    newBalance: number;
  }>
> {
  if (input.amount <= 0) {
    return { ok: false, reason: "invalid_input" };
  }

  let supabase: SupabaseClient;
  try {
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }

  const { data, error } = await supabase.rpc("process_wallet_spend", {
    p_business_id: input.businessId,
    p_amount: input.amount,
    p_description: input.description ?? null,
  });

  if (error) {
    if (error.message?.includes("Insufficient wallet balance")) {
      return { ok: false, reason: "insufficient_balance" };
    }
    if (error.message?.includes("Wallet not found")) {
      return { ok: false, reason: "wallet_not_found" };
    }
    return { ok: false, reason: "database_error" };
  }

  if (!data) return { ok: false, reason: "database_error" };

  const result = data as {
    transaction_id: string;
    new_balance: string | number;
  };

  return {
    ok: true,
    data: {
      transactionId: result.transaction_id,
      newBalance: toNumber(result.new_balance),
    },
  };
}

/**
 * Create a pending topup row (for redirect-based payment flows).
 * Does not change the balance — the transaction stays pending until
 * confirmed by the payment provider via `completeTopup`.
 */
export async function createPendingTopup(input: {
  businessId: string;
  amount: number;
  description?: string;
}): Promise<WalletServiceResult<{ transactionId: string }>> {
  if (input.amount <= 0) {
    return { ok: false, reason: "invalid_input" };
  }

  let supabase: SupabaseClient;
  try {
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }

  const { data, error } = await supabase.rpc("create_pending_topup", {
    p_business_id: input.businessId,
    p_amount: input.amount,
    p_description: input.description ?? null,
  });

  if (error || !data) return { ok: false, reason: "database_error" };

  const result = data as { transaction_id: string };

  return {
    ok: true,
    data: { transactionId: result.transaction_id },
  };
}

/**
 * Mark a pending topup as failed (e.g. payment declined or cancelled).
 * Does not affect the wallet balance.
 */
export async function failPendingTopup(input: {
  transactionId: string;
  businessId: string;
}): Promise<WalletServiceResult<void>> {
  let supabase: SupabaseClient;
  try {
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }

  const { data, error } = await supabase.rpc("fail_pending_topup", {
    p_transaction_id: input.transactionId,
    p_business_id: input.businessId,
  });

  if (error) {
    if (error.message?.includes("Transaction not found")) {
      return { ok: false, reason: "transaction_not_found" };
    }
    return { ok: false, reason: "database_error" };
  }

  if (!data) return { ok: false, reason: "database_error" };

  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Test-spend tool — debug only, not a real feature.
//
// This function is intentionally in the service layer so it goes through
// the same RLS and ownership checks as real operations. It will be removed
// or gated behind an admin flag once real ad spend exists.
// ---------------------------------------------------------------------------

/**
 * Simulate an ad spend deduction from the wallet. Creates a `spend`
 * ledger row with a clear test-only description.
 *
 * Unlike `processSpend` this uses a dedicated test RPC that may take the
 * balance negative, so the tool works even on a fresh Rs-0 wallet that has
 * never been topped up (top-ups are disabled until a payment provider is
 * configured). Intentionally test-only.
 *
 * REMOVE THIS FUNCTION once real ad spend deduction is wired to an
 * actual ad platform (Phase 5).
 */
export async function testSpend(input: {
  businessId: string;
  amount: number;
}): Promise<
  WalletServiceResult<{
    transactionId: string;
    newBalance: number;
  }>
> {
  if (input.amount <= 0) {
    return { ok: false, reason: "invalid_input" };
  }

  let supabase: SupabaseClient;
  try {
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }

  const { data, error } = await supabase.rpc("simulate_test_spend", {
    p_business_id: input.businessId,
    p_amount: input.amount,
    p_description: "Test ad spend (debug tool)",
  });

  if (error) {
    if (error.message?.includes("Insufficient wallet balance")) {
      return { ok: false, reason: "insufficient_balance" };
    }
    if (error.message?.includes("Wallet not found")) {
      return { ok: false, reason: "wallet_not_found" };
    }
    return { ok: false, reason: "database_error" };
  }

  if (!data) return { ok: false, reason: "database_error" };

  const result = data as {
    transaction_id: string;
    new_balance: string | number;
  };

  return {
    ok: true,
    data: {
      transactionId: result.transaction_id,
      newBalance: toNumber(result.new_balance),
    },
  };
}
