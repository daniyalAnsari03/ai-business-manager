"use client";

import { useI18n } from "@/components/i18n/language-provider";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { CurrencyCode } from "@/lib/business/constants";
import { formatMoney } from "@/lib/format/currency";
import { formatDateTime } from "@/lib/format/date";
import type { OrderStatus, OrderWithItems } from "@/lib/orders/types";

type OrderDetailsModalProps = {
  order: OrderWithItems;
  customerName: string | null;
  currency: CurrencyCode;
  onClose: () => void;
  onChangeStatus: () => void;
  onDelete: () => void;
};

/**
 * Read-only order receipt: items with their sale-time snapshots, totals
 * and the actions available for this order. Completed orders are financial
 * records, so delete is offered for every other status only.
 */
export function OrderDetailsModal({
  order,
  customerName,
  currency,
  onClose,
  onChangeStatus,
  onDelete,
}: OrderDetailsModalProps) {
  const { t, language } = useI18n();

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
          {canDelete(order.status) ? (
            <Button
              variant="ghost"
              size="lg"
              onClick={onDelete}
              className="w-full sm:w-auto"
            >
              {t.orders.details.deleteButton}
            </Button>
          ) : null}
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

function canDelete(status: OrderStatus): boolean {
  return status !== "completed";
}
