"use client";

import { useEffect, useState } from "react";
import { listPaymentsAction } from "@/app/actions/payments";
import { useI18n } from "@/components/i18n/language-provider";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { PaymentStatusChip } from "@/components/payments/payment-status-chip";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { CurrencyCode } from "@/lib/business/constants";
import { formatMoney } from "@/lib/format/currency";
import { formatDate, formatDateTime } from "@/lib/format/date";
import { orderPaymentStatus, type PaymentLedgerEntry } from "@/lib/payments/types";
import type { OrderWithItems } from "@/lib/orders/types";

type OrderDetailsModalProps = {
  order: OrderWithItems;
  customerName: string | null;
  currency: CurrencyCode;
  paid?: number;
  due?: number;
  onClose: () => void;
  onChangeStatus: () => void;
};

/**
 * Read-only order receipt: items with their sale-time snapshots, totals, the
 * money state and the payments recorded against this order (cancelled
 * payments are shown, not hidden).
 */
export function OrderDetailsModal({
  order,
  customerName,
  currency,
  paid,
  due,
  onClose,
  onChangeStatus,
}: OrderDetailsModalProps) {
  const { t, language } = useI18n();
  const [payments, setPayments] = useState<PaymentLedgerEntry[] | null>(null);
  const [paymentsFailed, setPaymentsFailed] = useState(false);

  useEffect(() => {
    let active = true;
    listPaymentsAction({ orderId: order.id }).then((result) => {
      if (!active) return;
      if (result.ok) setPayments(result.payments);
      else setPaymentsFailed(true);
    });
    return () => {
      active = false;
    };
  }, [order.id]);

  const paidValue = paid ?? 0;
  const dueValue = due ?? Math.max(order.total - paidValue, 0);
  const status = orderPaymentStatus({ total: order.total, paid: paidValue });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t.orders.details.title.replace("{number}", order.orderNumber)}
      description={formatDateTime(order.orderedAt, language)}
    >
      <div className="space-y-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface-raised px-4 py-3">
            <dt className="text-xs uppercase tracking-widest text-faint">
              {t.orders.details.statusLabel}
            </dt>
            <dd className="mt-1">
              <OrderStatusBadge status={order.status} />
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-surface-raised px-4 py-3">
            <dt className="text-xs uppercase tracking-widest text-faint">
              {t.orders.details.customerLabel}
            </dt>
            <dd className="mt-1 font-medium">
              {customerName ?? t.orders.walkIn}
            </dd>
          </div>
        </dl>

        {/* Money */}
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface-raised px-4 py-3">
            <dt className="text-xs uppercase tracking-widest text-faint">
              {t.orders.colPaid}
            </dt>
            <dd className="mt-1 font-display text-lg font-light tabular-nums">
              {formatMoney(paidValue, currency)}
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-surface-raised px-4 py-3">
            <dt className="text-xs uppercase tracking-widest text-faint">
              {t.orders.colDue}
            </dt>
            <dd className="mt-1 font-display text-lg font-light tabular-nums">
              {formatMoney(dueValue, currency)}
            </dd>
          </div>
          <div className="flex items-center rounded-xl border border-line bg-surface-raised px-4 py-3">
            <PaymentStatusChip status={status} />
          </div>
        </dl>

        {/* Items */}
        <div>
          <h3 className="mb-2 text-sm font-medium">
            {t.orders.details.itemsHeading}
          </h3>
          <ul className="overflow-hidden rounded-xl border border-line">
            {order.items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.productName}</p>
                  <p className="text-xs text-faint tabular-nums">
                    {formatMoney(item.unitPrice, currency)} ×{" "}
                    {item.quantity.toLocaleString("en-US")}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums">
                  {formatMoney(item.lineTotal, currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Totals */}
        <div className="space-y-1.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted">{t.orders.details.subtotalLabel}</span>
            <span className="tabular-nums">
              {formatMoney(order.subtotal, currency)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted">{t.orders.details.discountLabel}</span>
            <span className="tabular-nums">
              −{formatMoney(order.discount, currency)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-line pt-2">
            <span className="font-medium">{t.orders.details.totalLabel}</span>
            <span className="font-display text-lg font-light tabular-nums">
              {formatMoney(order.total, currency)}
            </span>
          </div>
        </div>

        {/* Payment history */}
        <div>
          <h3 className="mb-2 text-sm font-medium">
            {t.orders.paymentsHistory}
          </h3>
          {payments === null && !paymentsFailed ? (
            <p className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm text-muted">
              {t.common.loading}
            </p>
          ) : payments && payments.length > 0 ? (
            <ul className="overflow-hidden rounded-xl border border-line">
              {payments.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-sm last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium tabular-nums">
                      {formatMoney(entry.amount, currency)}
                    </p>
                    <p className="text-xs text-faint">
                      {formatDate(entry.paidAt, language)} ·{" "}
                      {t.payments.methods[entry.method]}
                    </p>
                  </div>
                  {entry.status === "reversed" ? (
                    <span className="rounded-full border border-line bg-surface-raised px-2.5 py-0.5 text-[11px] font-medium text-muted">
                      {t.payments.statusReversed}
                    </span>
                  ) : entry.kind === "reversal" ? (
                    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
                      {t.payments.kindReversal}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm text-muted">
              {t.orders.noPayments}
            </p>
          )}
        </div>

        {order.notes ? (
          <div className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm">
            <p className="text-xs uppercase tracking-widest text-faint">
              {t.orders.details.notesLabel}
            </p>
            <p className="mt-1 leading-relaxed">{order.notes}</p>
          </div>
        ) : null}

        {/* Actions */}
        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            size="lg"
            onClick={onChangeStatus}
            className="w-full sm:w-auto"
          >
            {t.orders.details.changeStatusButton}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
