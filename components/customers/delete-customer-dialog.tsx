"use client";

import { useState } from "react";
import { deleteCustomerAction } from "@/app/actions/customers";
import { useI18n } from "@/components/i18n/language-provider";
import { AlertCircleIcon, AlertTriangleIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { Customer } from "@/lib/customers/types";
import type { Dictionary } from "@/lib/i18n/dictionary";

type DeleteCustomerDialogProps = {
  customer: Customer;
  onClose: () => void;
  onDeleted: (id: string) => void;
};

/**
 * Explicit confirmation before removal (AGENTS.md §9) — a single click
 * never deletes. Past orders keep their customer snapshot via the
 * database design, so financial history stays intact.
 */
export function DeleteCustomerDialog({
  customer,
  onClose,
  onDeleted,
}: DeleteCustomerDialogProps) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setPending(true);
    setError(null);

    const result = await deleteCustomerAction(customer.id);
    if (!result.ok) {
      setPending(false);
      setError(
        t.customers.form.errors[
          result.reason as keyof Dictionary["customers"]["form"]["errors"]
        ],
      );
      return;
    }

    onDeleted(result.id);
  }

  return (
    <Modal open onClose={onClose} title={t.customers.deleteModal.title}>
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <p>{t.customers.deleteModal.body.replace("{name}", customer.name)}</p>
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
            type="button"
            variant="secondary"
            size="lg"
            onClick={onClose}
            disabled={pending}
            className="w-full sm:w-auto"
          >
            {t.customers.deleteModal.cancelButton}
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
                <span
                  aria-hidden
                  className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
                />
                {t.customers.deleteModal.deletingButton}
              </>
            ) : (
              t.customers.deleteModal.confirmButton
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
