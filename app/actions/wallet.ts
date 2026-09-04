"use server";

import {
  getWalletBalance,
  getWalletTransactions,
  testSpend,
  createPendingTopup,
  resolveBusinessId,
  type WalletServiceError,
} from "@/lib/marketing/wallet-service";
import { getPaymentProvider } from "@/lib/marketing/payment-provider";
import type { WalletTransaction } from "@/lib/marketing/types";

// ---------------------------------------------------------------------------
// Wallet balance
// ---------------------------------------------------------------------------

export type WalletBalanceActionState =
  | { ok: true; balance: number; walletId: string | null }
  | { ok: false; reason: WalletServiceError };

export async function getWalletBalanceAction(): Promise<WalletBalanceActionState> {
  const result = await getWalletBalance();
  if (result.ok) {
    return {
      ok: true,
      balance: result.data.balance,
      walletId: result.data.walletId,
    };
  }
  return { ok: false, reason: result.reason };
}

// ---------------------------------------------------------------------------
// Wallet transactions
// ---------------------------------------------------------------------------

export type WalletTransactionsActionState =
  | { ok: true; transactions: WalletTransaction[] }
  | { ok: false; reason: WalletServiceError };

export async function getWalletTransactionsAction(
  limit?: number,
): Promise<WalletTransactionsActionState> {
  const result = await getWalletTransactions(limit);
  return result.ok
    ? { ok: true, transactions: result.data }
    : { ok: false, reason: result.reason };
}

// ---------------------------------------------------------------------------
// Create pending topup
// ---------------------------------------------------------------------------

export type CreateTopupActionState =
  | { ok: true; transactionId: string }
  | { ok: false; reason: WalletServiceError };

/**
 * Create a pending topup ledger row. The business ID is resolved from the
 * authenticated session — no client-supplied ID is trusted.
 */
export async function createWalletTopupAction(
  amount: number,
): Promise<CreateTopupActionState> {
  const bizResult = await resolveBusinessId();
  if (!bizResult.ok) return { ok: false, reason: bizResult.reason };

  const result = await createPendingTopup({
    businessId: bizResult.data,
    amount,
    description: `Wallet top-up — Rs ${amount}`,
  });

  if (result.ok) {
    return { ok: true, transactionId: result.data.transactionId };
  }
  return { ok: false, reason: result.reason };
}

// ---------------------------------------------------------------------------
// Initiate wallet top-up via the configured payment provider
// ---------------------------------------------------------------------------

export type InitiateTopupActionState =
  | { ok: true; checkoutUrl: string }
  | { ok: false; reason: WalletServiceError | string };

/**
 * Creates a pending topup ledger row, initiates a payment checkout session,
 * and returns the hosted checkout URL for the client to redirect to.
 *
 * The business ID and wallet ID are resolved server-side — no client input
 * is trusted for authorization.
 */
export async function initiateWalletTopupAction(
  amount: number,
): Promise<InitiateTopupActionState> {
  const bizResult = await resolveBusinessId();
  if (!bizResult.ok) return { ok: false, reason: bizResult.reason };

  const businessId = bizResult.data;

  const provider = getPaymentProvider();
  if (!provider) {
    return { ok: false, reason: "Payment provider not configured" };
  }

  // Get wallet ID for the session metadata.
  const walletResult = await getWalletBalance();
  if (!walletResult.ok) {
    return { ok: false, reason: walletResult.reason };
  }
  const walletId = walletResult.data.walletId;
  if (!walletId) {
    return { ok: false, reason: "Wallet not found" };
  }

  // Create a pending ledger row before redirecting.
  const pendingResult = await createPendingTopup({
    businessId,
    amount,
    description: `Wallet top-up — Rs ${amount}`,
  });
  if (!pendingResult.ok) {
    return { ok: false, reason: pendingResult.reason };
  }

  // Build callback URLs.
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

  const successUrl = `${baseUrl}/dashboard/marketing`;
  const cancelUrl = `${baseUrl}/dashboard/marketing`;

  // Create the checkout session with the provider.
  const sessionResult = await provider.createSession({
    amount,
    businessId,
    walletId,
    currency: "PKR",
    successUrl,
    cancelUrl,
    metadata: {
      wallet_transaction_id: pendingResult.data.transactionId,
    },
  });

  if (!sessionResult.ok) {
    return { ok: false, reason: sessionResult.reason };
  }

  return { ok: true, checkoutUrl: sessionResult.url };
}

// ---------------------------------------------------------------------------
// Test spend (debug only)
//
// REMOVE this action once real ad spend deduction is wired to an actual
// ad platform. This is intentionally kept in the server actions layer so
// it goes through the same auth/ownership checks as real operations.
// ---------------------------------------------------------------------------

export type TestSpendActionState =
  | { ok: true; newBalance: number; transactionId: string }
  | { ok: false; reason: WalletServiceError };

/**
 * Simulate an ad spend deduction. The business is resolved from the
 * authenticated session — no client-supplied business id is trusted.
 */
export async function simulateAdSpendAction(
  amount: number,
): Promise<TestSpendActionState> {
  const bizResult = await resolveBusinessId();
  if (!bizResult.ok) return { ok: false, reason: bizResult.reason };

  const result = await testSpend({
    businessId: bizResult.data,
    amount,
  });

  if (result.ok) {
    return {
      ok: true,
      newBalance: result.data.newBalance,
      transactionId: result.data.transactionId,
    };
  }
  return { ok: false, reason: result.reason };
}
