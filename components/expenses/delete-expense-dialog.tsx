"use client";

import { useState } from "react";
import { deleteExpenseAction } from "@/app/actions/expenses";
import { useI18n } from "@/components/i18n/language-provider";
import { Spinner } from "@/components/expenses/expense-form-modal";
import { AlertCircleIcon, AlertTriangleIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { Expense } from "@/lib/expenses/types";
import type { Dictionary } from "@/lib/i18n/dictionary";

type DeleteExpenseDialogProps = {
  expense: Expense;
  onClose: () => void;
  onDeleted: (id: string) => void;
};

/** Explicit confirmation before removal (AGENTS.md §9) — irreversible. */
export function DeleteExpenseDialog({
  expense,
  onClose,
  onDeleted,
}: DeleteExpenseDialogProps) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setPending(true);
    setError(null);

    const result = await deleteExpenseAction(expense.id);
    if (!result.ok) {
      setPending(false);
      setError(
        t.expenses.form.errors[
          result.reason as keyof Dictionary["expenses"]["form"]["errors"]
        ],
      );
      return;
    }

    onDeleted(result.id);
  }

  return (
    <Modal open onClose={onClose} title={t.expenses.deleteModal.title}>
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            {t.expenses.deleteModal.body.replace("{title}", expense.title)}
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
            {t.expenses.deleteModal.cancelButton}
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
                {t.expenses.deleteModal.deletingButton}
              </>
            ) : (
              t.expenses.deleteModal.confirmButton
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
