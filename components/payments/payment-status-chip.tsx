"use client";

import { useI18n } from "@/components/i18n/language-provider";
import { cn } from "@/lib/utils";
import type { OrderPaymentStatus } from "@/lib/payments/types";

/**
 * Localized chip for an order's money state (Unpaid / Partial / Paid),
 * matching the visual language of the order status badge.
 */
export function PaymentStatusChip({
  status,
  className,
}: {
  status: OrderPaymentStatus;
  className?: string;
}) {
  const { t } = useI18n();

  const label =
    status === "paid"
      ? t.orders.payStatusPaid
      : status === "partial"
        ? t.orders.payStatusPartial
        : t.orders.payStatusUnpaid;

  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium",
        status === "paid"
          ? "border-emerald-500/40 bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300"
          : status === "partial"
            ? "border-line bg-surface-raised text-foreground"
            : "border-line bg-surface text-muted",
        className,
      )}
    >
      {label}
    </span>
  );
}
