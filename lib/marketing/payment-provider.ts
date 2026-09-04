/**
 * Payment provider abstraction — Phase 3.
 *
 * This interface keeps the wallet top-up flow provider-agnostic so we can
 * plug in any Pakistan-compatible payment gateway (JazzCash, EasyPaisa,
 * Stripe when available, etc.) without rewriting wallet logic.
 *
 * The wallet service calls into this interface; the concrete implementation
 * is selected at startup based on which credentials are configured.
 *
 * SECURITY: No raw card data ever passes through this interface. The
 * provider is responsible for handling sensitive payment details via its
 * own hosted fields, SDK, or redirect flow.
 */

export interface PaymentProviderSessionInput {
  /** Amount in the business's currency (always positive). */
  amount: number;
  /** The owning business id (server-derived, never client-trusted). */
  businessId: string;
  /** The wallet row id. */
  walletId: string;
  /** ISO 4217 currency code (e.g. "PKR"). */
  currency: string;
  /** URL to redirect after successful payment. */
  successUrl: string;
  /** URL to redirect after cancelled/failed payment. */
  cancelUrl: string;
  /** Optional key-value metadata forwarded to the gateway (e.g. wallet_transaction_id). */
  metadata?: Record<string, string>;
}

export type PaymentProviderSessionResult =
  | { ok: true; sessionId: string; url: string }
  | { ok: false; reason: string };

export type PaymentProviderVerifyResult =
  | { ok: true; amount: number; gatewayReference: string }
  | { ok: false; reason: string };

/**
 * Each payment gateway implements this interface. The wallet module only
 * interacts through this contract — it never imports a gateway SDK directly.
 */
export interface PaymentProvider {
  /** Short machine-readable id (e.g. "stripe", "jazzcash"). */
  readonly id: string;
  /** Human-readable name for UI display. */
  readonly displayName: string;

  /** Whether the required credentials are present in the environment. */
  isConfigured(): boolean;

  /**
   * Create a hosted checkout / payment session. Returns a URL the user
   * should be redirected to, or an error. Raw card data never touches
   * our server — the provider's hosted page handles it.
   */
  createSession(
    input: PaymentProviderSessionInput,
  ): Promise<PaymentProviderSessionResult>;

  /**
   * Verify a completed session after the user returns from the provider's
   * hosted page. Returns the verified amount and gateway reference, or
   * an error if the session is invalid/expired.
   */
  verifySession(sessionId: string): Promise<PaymentProviderVerifyResult>;
}

/**
 * Returns the active payment provider when one is configured, or null when
 * no provider is available (honest empty state).
 *
 * No payment gateway is currently connected, so this always returns null.
 * The wallet UI handles this by showing a "no payment provider configured"
 * notice instead of offering a broken top-up flow.
 */
export function getPaymentProvider(): PaymentProvider | null {
  return null;
}
