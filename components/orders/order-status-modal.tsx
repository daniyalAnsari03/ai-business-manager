"use client";

import { useState } from "react";
import { updateOrderStatusAction } from "@/app/actions/orders";
import { useI18n } from "@/components/i18n/language-provider";
import {
  statusChipClass,
  statusLabelText,
} from "@/components/orders/order-status-badge";
import { Spinner } from "@/components/orders/order-form-modal";
import { AlertCircleIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { Order, OrderStatus } from "@/lib/orders/types";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { cn } from "@/lib/utils";

type OrderStatusModalProps = {
  order: Order;
  onClose: () => void;
  onSaved: (order: Order) => void;
};

type ActionReason = keyof Dictionary["orders"]["create"]["errors"];

/**
 * Status change with honest stock implications spelled out before the
 * user confirms (AGENTS.md §9/§26): completing deducts stock automatically,
 * leaving completed restores it.
 */
export function OrderStatusModal({ order, onClose, onSaved }: OrderStatusModalProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    if (status === order.status) {
      onClose();
      return;
    }
    setPending(true);
    setError(null);

    const result = await updateOrderStatusAction(order.id, status);
    if (!result.ok) {
      setPending(false);
      setError(t.orders.create.errors[result.reason as ActionReason]);
      return;
    }

    onSaved(result.order);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t.orders.statusModal.title}
      description={order.orderNumber}
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm shadow-card">
          <span className="text-muted">{t.orders.statusModal.currentLabel}</span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
              statusChipClass(order.status),
            )}
          >
            {statusLabelText(t)[order.status]}
          </span>
        </div>

        <fieldset className="space-y-2">
          <legend className="sr-only">{t.orders.details.statusLabel}</legend>
          {(Object.keys(statusLabelText(t)) as OrderStatus[]).map((value) => (
            <label
              key={value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-sm transition-colors",
                status === value
                  ? "border-emerald-500/50 bg-emerald-500/[0.08] text-foreground"
                  : "border-line bg-surface text-muted hover:border-emerald-500/30 hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name={`order-status-${order.id}`}
                value={value}
                checked={status === value}
                onChange={() => setStatus(value)}
                disabled={pending}
                className="size-4 accent-emerald-600"
              />
              <span className="flex-1 font-medium">
                {statusLabelText(t)[value]}
              </span>
            </label>
          ))}
        </fieldset>

        {status !== order.status && status === "completed" ? (
          <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs leading-relaxed text-emerald-700 dark:text-emerald-300">
            {t.orders.statusModal.noteComplete}
          </p>
        ) : null}
        {status !== order.status && order.status === "completed" ? (
          <p className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-xs leading-relaxed text-muted">
            {t.orders.statusModal.noteRestore}
          </p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted"
          >
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            size="lg"
            onClick={onClose}
            disabled={pending}
            className="w-full sm:w-auto"
          >
            {t.orders.statusModal.cancelButton}
          </Button>
          <Button size="lg" onClick={handleConfirm} disabled={pending} className="w-full sm:w-auto">
            {pending ? (
              <>
                <Spinner />
                {t.orders.statusModal.savingButton}
              </>
            ) : (
              t.orders.statusModal.confirmButton
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
