"use client";

import { useI18n } from "@/components/i18n/language-provider";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/orders/types";

export type { OrderStatus };

/** Localized label per order status. */
export function statusLabelText(
  t: Dictionary,
): Record<OrderStatus, string> {
  return {
    pending: t.orders.statusPending,
    confirmed: t.orders.statusConfirmed,
    processing: t.orders.statusProcessing,
    completed: t.orders.statusCompleted,
    cancelled: t.orders.statusCancelled,
  };
}

/** Muted semantic chip colors — functional distinction, not decoration. */
export function statusChipClass(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "border-line bg-surface text-muted";
    case "confirmed":
      return "border-line bg-surface-raised text-foreground";
    case "processing":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "completed":
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-900 dark:text-emerald-200";
    case "cancelled":
      return "border-line bg-surface text-faint";
  }
}

/** Small rounded status chip used across the Orders and Sales modules. */
export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium",
        statusChipClass(status),
        className,
      )}
    >
      {statusLabelText(t)[status]}
    </span>
  );
}
