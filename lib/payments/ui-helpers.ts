/**
 * Pure decision helpers shared by the payments screens.
 *
 * These are deliberately dependency-free so the exact rules the UI renders are
 * the same rules the offline tests exercise (docs/fix.txt Stage 5, "UI helper
 * tests: menu item rules, payment form validation and amount defaults, status
 * chip derivation").
 */

import type { PaymentLedgerEntry } from "@/lib/payments/types";

export type PaymentCancelDisabledReason = "reversal" | "reversed";

export interface PaymentRowActionState {
  /** Cancel (reverse) is the only paid action a ledger row ever has. */
  cancelDisabled: boolean;
  cancelDisabledReason: PaymentCancelDisabledReason | null;
}

/**
 * Which row action is available for a ledger entry, purely from its own state:
 * a reversal row has no money to cancel, an already-cancelled payment is
 * flagged, everything else can be cancelled (the write itself still goes
 * through the confirmation dialog). There is NO hard delete for payments; the
 * only remedy is a reversal row.
 */
export function paymentCancelState(
  entry: PaymentLedgerEntry,
): PaymentRowActionState {
  if (entry.kind === "reversal") {
    return { cancelDisabled: true, cancelDisabledReason: "reversal" };
  }
  if (entry.status === "reversed") {
    return { cancelDisabled: true, cancelDisabledReason: "reversed" };
  }
  return { cancelDisabled: false, cancelDisabledReason: null };
}

/** The record-payment form opens pre-filled with the full outstanding due. */
export function paymentFormAmountDefault(due: number): string {
  return String(due);
}