"use server";

import {
  getOrderPaymentSummary,
  getPayment,
  listOrderPaymentSummaries,
  listPayments,
  recordPayment,
  reversePayment,
  type PaymentServiceError,
} from "@/lib/payments/service";
import type {
  OrderPaymentSummary,
  PaymentLedgerEntry,
  RecordPaymentResult,
  ReversePaymentResult,
} from "@/lib/payments/types";

export type PaymentListActionState =
  | { ok: true; payments: PaymentLedgerEntry[] }
  | { ok: false; reason: PaymentServiceError };

export type RecordPaymentActionState =
  | { ok: true; data: RecordPaymentResult }
  | { ok: false; reason: PaymentServiceError };

export type ReversePaymentActionState =
  | { ok: true; data: ReversePaymentResult }
  | { ok: false; reason: PaymentServiceError };

export type OrderPaymentSummaryActionState =
  | { ok: true; summary: OrderPaymentSummary }
  | { ok: false; reason: PaymentServiceError };

/**
 * Thin server-action boundary over the payments ledger service. Money only
 * ever moves through `record_payment` / `reverse_payment`, which resolve the
 * business and actor from the session; the ledger is append-only.
 */

export async function listPaymentsAction(
  options: Parameters<typeof listPayments>[0] = {},
): Promise<PaymentListActionState> {
  const result = await listPayments(options);
  return result.ok
    ? { ok: true, payments: result.data }
    : { ok: false, reason: result.reason };
}

export async function recordPaymentAction(
  input: unknown,
): Promise<RecordPaymentActionState> {
  const result = await recordPayment(input);
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, reason: result.reason };
}

export async function reversePaymentAction(
  input: unknown,
): Promise<ReversePaymentActionState> {
  const result = await reversePayment(input);
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, reason: result.reason };
}

export async function getOrderPaymentSummaryAction(
  orderId: string,
): Promise<OrderPaymentSummaryActionState> {
  const result = await getOrderPaymentSummary(orderId);
  return result.ok
    ? { ok: true, summary: result.data }
    : { ok: false, reason: result.reason };
}

export async function listOrderPaymentSummariesAction(): Promise<
  { ok: true; summaries: OrderPaymentSummary[] } | { ok: false; reason: PaymentServiceError }
> {
  const result = await listOrderPaymentSummaries();
  return result.ok
    ? { ok: true, summaries: result.data }
    : { ok: false, reason: result.reason };
}

export async function getPaymentAction(
  paymentId: string,
): Promise<{
  ok: true;
  payment: PaymentLedgerEntry;
} | { ok: false; reason: PaymentServiceError }> {
  const result = await getPayment(paymentId);
  return result.ok
    ? { ok: true, payment: result.data }
    : { ok: false, reason: result.reason };
}