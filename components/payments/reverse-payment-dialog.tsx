"use client";

import { useState, type FormEvent } from "react";
import { reversePaymentAction } from "@/app/actions/payments";
import { useI18n } from "@/components/i18n/language-provider";
import { Spinner } from "@/components/customers/customer-form-modal";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon, AlertTriangleIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import type { CurrencyCode } from "@/lib/business/constants";
import { formatMoney } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/date";
import { PAYMENT_LIMITS, validateReversePaymentInput } from "@/lib/payments/validation";
import type {
  PaymentLedgerEntry,
  ReversePaymentResult,
} from "@/lib/payments/types";
import type { Dictionary } from "@/lib/i18n/dictionary";

function createIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to a time-based key.
  }
  return `rev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Cancel (reverse) a payment. The ledger is append-only: this adds a mirror
 * reversal row, the due goes back up, and the original row is never deleted.
 */
export function ReversePaymentDialog({
  payment,
  currency,
  onClose,
  onReversed,
}: {
  payment: PaymentLedgerEntry;
  currency: CurrencyCode;
  onClose: () => void;
  onReversed: (result: ReversePaymentResult) => void;
}) {
  const { t, language } = useI18n();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [idempotencyKey] = useState(createIdempotencyKey);

  async function handleConfirm() {
    setError(null);
    setReasonError(null);

    const validated = validateReversePaymentInput({
      paymentId: payment.id,
      reason,
      idempotencyKey,
    });
    if (!validated.ok) {
      if (validated.fieldErrors.reason === "required") {
        setReasonError(t.payments.reverse.reasonRequired);
      } else if (validated.fieldErrors.reason === "too_long") {
        setReasonError(t.payments.reverse.reasonTooLong);
      }
      return;
    }

    setPending(true);
    const result = await reversePaymentAction(validated.value);
    if (!result.ok) {
      setPending(false);
      setError(
        t.payments.reverse.errors[
          result.reason as keyof Dictionary["payments"]["reverse"]["errors"]
        ] ?? t.payments.reverse.errors.database_error,
      );
      return;
    }
    onReversed(result.data);
  }

  return (
    <Modal open onClose={onClose} title={t.payments.reverse.title}>
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            {t.payments.reverse.body
              .replace("{amount}", formatMoney(payment.amount, currency))
              .replace("{date}", formatDate(payment.paidAt, language))}
          </p>
        </div>

        <div className="w-full">
          <label
            htmlFor="reverse-reason"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {t.payments.reverse.reasonLabel}
          </label>
          <textarea
            id="reverse-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t.payments.reverse.reasonPlaceholder}
            rows={3}
            maxLength={500}
            aria-invalid={reasonError ? true : undefined}
            className="min-h-[5.5rem] w-full resize-y rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-foreground shadow-card transition-colors duration-200 placeholder:text-faint hover:border-emerald-500/30 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
          />
          {reasonError ? (
            <p
              role="alert"
              className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted"
            >
              <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
              {reasonError}
            </p>
          ) : null}
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
            {t.payments.cancelButton}
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
                {t.payments.reverse.reversingButton}
              </>
            ) : (
              t.payments.reverse.confirmButton
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
