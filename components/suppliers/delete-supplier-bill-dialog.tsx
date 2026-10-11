"use client";

import { useState } from "react";
import { deleteSupplierBillAction } from "@/app/actions/supplier-bills";
import { useI18n } from "@/components/i18n/language-provider";
import { AlertCircleIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { SupplierBillWithDetails } from "@/lib/supplier-bills/types";
import type { Dictionary } from "@/lib/i18n/dictionary";

/**
 * Confirms deleting a supplier bill. When payments exist the database refuses;
 * that is explained and the user is offered a way to view those payments
 * instead of a raw error.
 */
export function DeleteSupplierBillDialog({
  bill,
  onClose,
  onDeleted,
  onViewPayments,
}: {
  bill: SupplierBillWithDetails;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onViewPayments?: () => void;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label =
    bill.billNumber && bill.billNumber.trim().length > 0
      ? bill.billNumber
      : bill.supplierName;

  async function handleConfirm() {
    setPending(true);
    setError(null);

    const result = await deleteSupplierBillAction(bill.id);
    if (!result.ok) {
      setPending(false);
      if (result.reason === "has_payments") {
        setBlocked(true);
        return;
      }
      setError(
        t.supplierBills.create.errors[
          result.reason as keyof Dictionary["supplierBills"]["create"]["errors"]
        ] ?? t.supplierBills.create.errors.database_error,
      );
      return;
    }

    onDeleted(result.id);
  }

  return (
    <Modal open onClose={onClose} title={t.supplierBills.deleteModal.title}>
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <p>{t.supplierBills.deleteModal.body.replace("{label}", label)}</p>
        </div>

        {blocked ? (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] px-4 py-3 text-sm leading-relaxed text-foreground">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-accent" />
            <div>
              <p className="font-medium">
                {t.supplierBills.deleteModal.blockTitleHasPayments}
              </p>
              <p className="mt-1 text-muted">
                {t.supplierBills.deleteModal.blockBodyHasPayments}
              </p>
              {onViewPayments ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3"
                  onClick={onViewPayments}
                >
                  {t.payments.title}
                </Button>
              ) : null}
            </div>
          </div>
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
            type="button"
            variant="secondary"
            size="lg"
            onClick={onClose}
            disabled={pending}
            className="w-full sm:w-auto"
          >
            {t.supplierBills.deleteModal.cancelButton}
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={handleConfirm}
            disabled={pending || blocked}
            className="w-full sm:w-auto"
          >
            {pending
              ? t.supplierBills.deleteModal.deletingButton
              : t.supplierBills.deleteModal.confirmButton}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
