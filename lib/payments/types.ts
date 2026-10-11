/** Payments ledger domain types shared by the service layer, actions and UI. */

export const PAYMENT_METHODS = [
  "cash",
  "bank",
  "easypaisa",
  "jazzcash",
  "cheque",
  "other",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly unknown[]).includes(value);
}

export type PaymentKind = "payment" | "reversal";
export type PaymentDirection = "in" | "out";

/** Status a payment has from the ledger's point of view. */
export type PaymentLedgerStatus = "active" | "reversed";

export interface Payment {
  id: string;
  businessId: string;
  kind: PaymentKind;
  /** 'in' = customer money received against an order, 'out' = we paid a supplier. */
  direction: PaymentDirection;
  orderId: string | null;
  supplierBillId: string | null;
  /** The payment this row undoes; non-null exactly when kind = 'reversal'. */
  reversalOf: string | null;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  reference: string | null;
  notes: string | null;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
}

/** A ledger row enriched for list/detail screens. */
export interface PaymentLedgerEntry extends Payment {
  status: PaymentLedgerStatus;
  /** Human label for the linked target (order number / bill reference). */
  targetLabel: string | null;
}

export interface RecordPaymentInput {
  /** Exactly one of orderId / supplierBillId must be set (direction follows). */
  orderId?: string | null;
  supplierBillId?: string | null;
  amount: number;
  method: PaymentMethod;
  paidAt?: string | null;
  reference?: string | null;
  notes?: string | null;
  idempotencyKey: string;
}

export interface ReversePaymentInput {
  paymentId: string;
  reason: string;
  idempotencyKey: string;
}

/** What `record_payment` promised on the returned side of the money. */
export interface RecordPaymentResult {
  payment: Payment;
  /** true when the idempotency key matched an existing row (safe retry). */
  idempotentReplay: boolean;
  orderId: string | null;
  supplierBillId: string | null;
  /** Customer side. */
  netPaid?: number;
  paid?: number;
  due?: number;
  /** Supplier side. */
  paidAmount?: number;
}

export interface ReversePaymentResult {
  payment: Payment;
  idempotentReplay: boolean;
  reversedPaymentId: string;
  orderId: string | null;
  supplierBillId: string | null;
  netPaid?: number;
  paid?: number;
  due?: number;
  paidAmount?: number;
}

/** Per-order receivables for the whole business (RE cé RLS-protected read). */
export interface OrderPaymentSummary {
  orderId: string;
  orderNumber: string;
  customerId: string;
  status: string;
  orderedAt: string;
  total: number;
  openingPaid: number;
  netPaid: number;
  paid: number;
  due: number;
  paymentCount: number;
}

export type OrderPaymentStatus = "unpaid" | "partial" | "paid";

export function orderPaymentStatus(
  summary: Pick<OrderPaymentSummary, "total" | "paid">,
): OrderPaymentStatus {
  if (summary.paid >= summary.total) return "paid";
  if (summary.paid > 0) return "partial";
  return "unpaid";
}