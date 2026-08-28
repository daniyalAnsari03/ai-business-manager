"use client";

import { useState, type FormEvent } from "react";
import {
  createExpenseAction,
  updateExpenseAction,
} from "@/app/actions/expenses";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select";
import { TextField } from "@/components/ui/input";
import {
  EXPENSE_CATEGORIES,
  type Expense,
  type ExpenseCategory,
} from "@/lib/expenses/types";
import {
  validateExpenseInput,
  type ExpenseField,
  type ExpenseFieldErrors,
} from "@/lib/expenses/validation";
import type { Dictionary } from "@/lib/i18n/dictionary";

type ExpenseFormModalProps = {
  /** Existing expense -> edit mode; omitted -> add mode. */
  expense?: Expense;
  onClose: () => void;
  onSaved: (expense: Expense, mode: "create" | "update") => void;
};

type ActionReason = keyof Dictionary["expenses"]["form"]["errors"];

/**
 * Add/Edit expense dialog. Validation runs client-side for instant
 * feedback and is re-run authoritatively inside the server service.
 */
export function ExpenseFormModal({
  expense,
  onClose,
  onSaved,
}: ExpenseFormModalProps) {
  const { t } = useI18n();
  const isEdit = Boolean(expense);

  const [title, setTitle] = useState(expense?.title ?? "");
  const [amount, setAmount] = useState(
    expense ? String(expense.amount) : "",
  );
  const [category, setCategory] = useState<ExpenseCategory | "">(
    expense?.category ?? "",
  );
  const [expenseDate, setExpenseDate] = useState(
    expense?.expenseDate ?? new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(expense?.notes ?? "");

  const [fieldErrors, setFieldErrors] = useState<ExpenseFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function fieldErrorText(field: ExpenseField): string | undefined {
    const code = fieldErrors[field];
    return code ? t.expenses.form.fieldErrors[code] : undefined;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const validated = validateExpenseInput({
      title,
      amount,
      category,
      expenseDate,
      notes,
    });
    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors);
      return;
    }
    setFieldErrors({});
    setPending(true);

    const result = isEdit
      ? await updateExpenseAction(expense!.id, validated.value)
      : await createExpenseAction(validated.value);

    if (!result.ok) {
      setPending(false);
      setFormError(t.expenses.form.errors[result.reason as ActionReason]);
      return;
    }

    onSaved(result.expense, isEdit ? "update" : "create");
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? t.expenses.form.editTitle : t.expenses.form.addTitle}
      description={
        isEdit ? t.expenses.form.editDescription : t.expenses.form.addDescription
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <TextField
          id="expense-title"
          label={t.expenses.form.titleLabel}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t.expenses.form.titlePlaceholder}
          error={fieldErrorText("title")}
          maxLength={120}
          autoComplete="off"
          required
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id="expense-amount"
            label={t.expenses.form.amountLabel}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0"
            error={fieldErrorText("amount")}
            inputMode="decimal"
            autoComplete="off"
            required
          />
          <TextField
            id="expense-date"
            label={t.expenses.form.dateLabel}
            type="date"
            value={expenseDate}
            onChange={(event) => setExpenseDate(event.target.value)}
            error={fieldErrorText("expenseDate")}
            required
          />
        </div>

        <SelectField
          id="expense-category"
          label={t.expenses.form.categoryLabel}
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as ExpenseCategory | "")
          }
          error={fieldErrorText("category")}
          required
        >
          <option value="" disabled>
            —
          </option>
          {EXPENSE_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t.expenses.categories[value]}
            </option>
          ))}
        </SelectField>

        <div className="w-full">
          <label
            htmlFor="expense-notes"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {t.expenses.form.notesLabel}
          </label>
          <textarea
            id="expense-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t.expenses.form.notesPlaceholder}
            rows={2}
            maxLength={2000}
            className="min-h-[4.5rem] w-full resize-y rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-foreground shadow-card transition-colors duration-200 placeholder:text-faint hover:border-emerald-500/30 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
          />
        </div>

        {formError ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted"
          >
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
            {formError}
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={onClose}
            disabled={pending}
            className="w-full sm:w-auto"
          >
            {t.expenses.form.cancelButton}
          </Button>
          <Button
            type="submit"
            size="lg"
            disabled={pending}
            className="w-full sm:w-auto"
          >
            {pending ? (
              <>
                <Spinner />
                {t.expenses.form.savingButton}
              </>
            ) : (
              t.expenses.form.saveButton
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
    />
  );
}
