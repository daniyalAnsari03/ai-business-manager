"use client";

import { useState } from "react";
import { deleteSupplierAction } from "@/app/actions/suppliers";
import { useI18n } from "@/components/i18n/language-provider";
import { AlertCircleIcon, AlertTriangleIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { Supplier } from "@/lib/suppliers/types";
import type { Dictionary } from "@/lib/i18n/dictionary";

/**
 * Explicit confirmation before deleting a supplier. The database refuses when
 * bills still exist; that case is explained instead of being shown as a
 * generic failure.
 */
export function DeleteSupplierDialog({
  supplier,
  onClose,
  onDeleted,
}: {
  supplier: Supplier;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setPending(true);
    setError(null);

    const result = await deleteSupplierAction(supplier.id);
    if (!result.ok) {
      setPending(false);
      if (result.reason === "supplier_has_bills") {
        setBlocked(true);
        return;
      }
      setError(
        t.suppliers.form.errors[
          result.reason as keyof Dictionary["suppliers"]["form"]["errors"]
        ] ?? t.suppliers.form.errors.database_error,
      );
      return;
    }

    onDeleted(result.id);
  }

  return (
    <Modal open onClose={onClose} title={t.suppliers.deleteModal.title}>
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <p>{t.suppliers.deleteModal.body.replace("{name}", supplier.name)}</p>
        </div>

        {blocked ? (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] px-4 py-3 text-sm leading-relaxed text-foreground">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-accent" />
            <div>
              <p className="font-medium">
                {t.suppliers.deleteModal.blockTitleHasBills}
              </p>
              <p className="mt-1 text-muted">
                {t.suppliers.deleteModal.blockBodyHasBills.replace(
                  "{name}",
                  supplier.name,
                )}
              </p>
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
            {t.suppliers.deleteModal.cancelButton}
          </Button>
          {blocked ? null : (
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
                  {t.suppliers.deleteModal.deletingButton}
                </>
              ) : (
                <>
                  <AlertCircleIcon className="size-4" />
                  {t.suppliers.deleteModal.confirmButton}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
