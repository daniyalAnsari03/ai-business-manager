"use client";

import { useState } from "react";
import { deleteOrderAction } from "@/app/actions/orders";
import { useI18n } from "@/components/i18n/language-provider";
import { Spinner } from "@/components/orders/order-form-modal";
import { AlertCircleIcon, AlertTriangleIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { Order } from "@/lib/orders/types";
import type { Dictionary } from "@/lib/i18n/dictionary";

type DeleteOrderDialogProps = {
  order: Order;
  onClose: () => void;
  onDeleted: (id: string) => void;
};

type ActionReason = keyof Dictionary["orders"]["create"]["errors"];

/**
 * Explicit confirmation before removal (AGENTS.md §9). Completed orders
 * never reach this dialog — the database refuses them regardless.
 */
export function DeleteOrderDialog({
  order,
  onClose,
  onDeleted,
}: DeleteOrderDialogProps) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setPending(true);
    setError(null);

    const result = await deleteOrderAction(order.id);
    if (!result.ok) {
      setPending(false);
      setError(t.orders.create.errors[result.reason as ActionReason]);
      return;
    }

    onDeleted(result.id);
  }

  return (
    <Modal open onClose={onClose} title={t.orders.deleteModal.title}>
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            {t.orders.deleteModal.body.replace("{number}", order.orderNumber)}
          </p>
        </div>

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
            {t.orders.deleteModal.cancelButton}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={handleConfirm}
            disabled={pending}
            className="w-full sm:w-auto"
          >
            {pending ? (
              <>
                <Spinner />
                {t.orders.deleteModal.deletingButton}
              </>
            ) : (
              t.orders.deleteModal.confirmButton
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
