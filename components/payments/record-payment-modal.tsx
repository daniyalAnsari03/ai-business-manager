"use client";

import { useState, type FormEvent } from "react";
import { recordPaymentAction } from "@/app/actions/payments";
import { useI18n } from "@/components/i18n/language-provider";
import { Spinner } from "@/components/customers/customer-form-modal";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon } from "@/components/ui/icons";
import { TextField } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select";
import type { CurrencyCode } from "@/lib/business/constants";
import { formatMoney } from "@/lib/format/currency";
import { paymentFormAmountDefault } from "@/lib/payments/ui-helpers";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  type RecordPaymentResult,
} from "@/lib/payments/types";
import {
  validateRecordPaymentInput,
  type PaymentField,
} from "@/lib/payments/validation";
import type { Dictionary } from "@/lib/i18n/dictionary";

/** The order or supplier bill a payment is being recorded against. */
export type PaymentTarget =
  | {
      kind: "order";
      id: string;
      label: string;
      total: number;
      paid: number;
      due: number;
    }
  | {
      kind: "bill";
      id: string;
      label: string;
      total: number;
      paid: number;
      due: number;
    };

type FieldErrorKey = keyof Dictionary["payments"]["fieldErrors"];

function createIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to a time-based key.
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function todayIsoDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

/**
 * Records real money against either an order (customer in) or a supplier bill
 * (money out). The idempotency key is created ONCE when the form opens, so a
 * repeated submit after a slow response replays the same payment instead of
 * recording it twice (the database enforces the same key).
 */
export function RecordPaymentModal({
  target,
  currency,
  onClose,
  onRecorded,
}: {
  target: PaymentTarget;
  currency: CurrencyCode;
  onClose: () => void;
  onRecorded: (result: RecordPaymentResult) => void;
}) {
  const { t } = useI18n();

  const [amount, setAmount] = useState(paymentFormAmountDefault(target.due));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [paidAt, setPaidAt] = useState(todayIsoDate());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<PaymentField, FieldErrorKey>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [idempotencyKey] = useState(createIdempotencyKey);

  function fieldErrorText(field: PaymentField): string | undefined {
    const code = fieldErrors[field];
    return code ? t.payments.fieldErrors[code] : undefined;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsedAmount = Number(amount.replace(/,/g, "").trim());
    const validated = validateRecordPaymentInput({
      orderId: target.kind === "order" ? target.id : "",
      supplierBillId: target.kind === "bill" ? target.id : "",
      amount: parsedAmount,
      method,
      paidAt,
      reference,
      notes,
      idempotencyKey,
    });

    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors);
      return;
    }
    setFieldErrors({});
    setPending(true);

    const result = await recordPaymentAction(validated.value);
    if (!result.ok) {
      setPending(false);
      setFormError(
        t.payments.errors[result.reason as keyof Dictionary["payments"]["errors"]],
      );
      return;
    }

    onRecorded(result.data);
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t.payments.confirmButton}
      description={t.payments.reviewNote}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* What is being paid + how much is left */}
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface-raised px-4 py-3">
            <dt className="text-xs uppercase tracking-widest text-faint">
              {t.payments.colTarget}
            </dt>
            <dd className="mt-1 truncate font-medium">{target.label}</dd>
          </div>
          <div className="rounded-xl border border-line bg-surface-raised px-4 py-3">
            <dt className="text-xs uppercase tracking-widest text-faint">
              {t.supplierBills.colPaid}
            </dt>
            <dd className="mt-1 font-medium tabular-nums">
              {formatMoney(target.paid, currency)}
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-surface-raised px-4 py-3">
            <dt className="text-xs uppercase tracking-widest text-faint">
              {t.supplierBills.colDue}
            </dt>
            <dd className="mt-1 font-medium tabular-nums">
              {formatMoney(target.due, currency)}
            </dd>
          </div>
        </dl>

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id="payment-amount"
            label={t.payments.colAmount}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            error={fieldErrorText("amount")}
            inputMode="decimal"
            autoComplete="off"
          />
          <SelectField
            id="payment-method"
            label={t.payments.colMethod}
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            error={fieldErrorText("method")}
          >
            {PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {t.payments.methods[value]}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id="payment-date"
            label={t.payments.colDate}
            type="date"
            value={paidAt}
            onChange={(event) => setPaidAt(event.target.value)}
            error={fieldErrorText("paidAt")}
          />
          <TextField
            id="payment-reference"
            label={t.payments.referenceLabel}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder={t.payments.referencePlaceholder}
            error={fieldErrorText("reference")}
            autoComplete="off"
          />
        </div>

        <div className="w-full">
          <label
            htmlFor="payment-notes"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {t.supplierBills.details.notesLabel}
          </label>
          <textarea
            id="payment-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t.payments.notesPlaceholder}
            rows={3}
            maxLength={1000}
            className="min-h-[5.5rem] w-full resize-y rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-foreground shadow-card transition-colors duration-200 placeholder:text-faint hover:border-emerald-500/30 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
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
            {t.payments.cancelButton}
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
                {t.payments.savingButton}
              </>
            ) : (
              t.payments.confirmButton
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
