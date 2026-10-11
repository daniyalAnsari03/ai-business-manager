"use client";

import { useEffect, useState } from "react";
import { listPaymentsAction } from "@/app/actions/payments";
import { useI18n } from "@/components/i18n/language-provider";
import { ReversePaymentDialog } from "@/components/payments/reverse-payment-dialog";
import { Card } from "@/components/ui/card";
import {
  AlertTriangleIcon,
  ArrowsUpDownIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowMenu } from "@/components/ui/row-menu";
import type { Business } from "@/lib/business/types";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/currency";
import { cn } from "@/lib/utils";
import { paymentCancelState } from "@/lib/payments/ui-helpers";
import type { PaymentLedgerEntry } from "@/lib/payments/types";

type DirectionFilter = "all" | "in" | "out";
type ActiveModal = { type: "reverse"; entry: PaymentLedgerEntry } | null;
type Toast = { id: number; kind: "success" | "error"; text: string };

/**
 * Payments ledger. Every row is real (recorded through the RPCs); a payment is
 * never deleted — cancelling adds a reversal row and the due goes back up.
 */
export function PaymentsView({
  business,
  initialPayments,
  loadFailed = false,
}: {
  business: Business;
  initialPayments: PaymentLedgerEntry[];
  loadFailed?: boolean;
}) {
  const { t, language } = useI18n();
  const [payments, setPayments] = useState(initialPayments);
  const [filter, setFilter] = useState<DirectionFilter>("all");
  const [modal, setModal] = useState<ActiveModal>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (loadFailed) {
    return <LoadError />;
  }

  function showToast(kind: Toast["kind"], text: string) {
    setToast({ id: Date.now(), kind, text });
  }

  function canReverse(entry: PaymentLedgerEntry): {
    disabled: boolean;
    reason?: string;
  } {
    const state = paymentCancelState(entry);
    if (!state.cancelDisabled) return { disabled: false };
    return {
      disabled: true,
      reason:
        state.cancelDisabledReason === "reversal"
          ? t.payments.cancelDisabledReversal
          : t.payments.cancelDisabledReversed,
    };
  }

  async function refreshLedger() {
    const result = await listPaymentsAction();
    if (result.ok) setPayments(result.payments);
  }

  const visible = payments.filter((entry) =>
    filter === "all" ? true : entry.direction === filter,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <ArrowsUpDownIcon className="size-3.5" />
            {t.nav.payments}
          </>
        }
        title={t.payments.title}
        subtitle={t.payments.subtitle}
        action={
          <div className="inline-flex rounded-xl border border-line bg-surface p-1">
            {(
              [
                ["all", t.payments.tabs.all],
                ["in", t.payments.directionIn],
                ["out", t.payments.directionOut],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={cn(
                  "rounded-lg px-3.5 py-2 text-sm transition-colors",
                  filter === value
                    ? "bg-surface-raised text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {payments.length === 0 ? (
        <Card lift={false} className="relative overflow-hidden">
          <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
          <div className="relative flex flex-col items-center py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
              <ArrowsUpDownIcon className="size-6" />
            </span>
            <h2 className="mt-5 font-display text-2xl font-light">
              {t.payments.emptyTitle}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              {t.payments.emptyBody}
            </p>
          </div>
        </Card>
      ) : visible.length === 0 ? (
        <Card lift={false} className="py-12 text-center">
          <h2 className="text-[15px] font-medium">
            {t.payments.noResultsTitle}
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            {t.payments.noResultsBody}
          </p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          {visible.map((entry) => {
            const reverse = canReverse(entry);
            return (
              <div
                key={entry.id}
                className="flex items-center gap-4 border-b border-line px-5 py-3.5 transition-colors hover:bg-surface-raised/60 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">
                    {entry.targetLabel ??
                      (entry.direction === "in"
                        ? t.payments.directionIn
                        : t.payments.directionOut)}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {formatDate(entry.paidAt, language)} ·{" "}
                    {t.payments.methods[entry.method]}
                  </p>
                </div>
                <span
                  className={cn(
                    "hidden rounded-full px-2.5 py-0.5 text-[11px] font-medium sm:inline-flex",
                    entry.direction === "in"
                      ? "bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300"
                      : "bg-foreground/[0.06] text-muted",
                  )}
                >
                  {entry.direction === "in"
                    ? t.payments.directionIn
                    : t.payments.directionOut}
                </span>
                {entry.status === "reversed" ? (
                  <span className="rounded-full border border-line bg-surface-raised px-2.5 py-0.5 text-[11px] font-medium text-muted">
                    {t.payments.statusReversed}
                  </span>
                ) : entry.kind === "reversal" ? (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
                    {t.payments.kindReversal}
                  </span>
                ) : null}
                <div
                  className={cn(
                    "w-28 shrink-0 text-right text-sm font-medium tabular-nums",
                    entry.direction === "in"
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-foreground",
                  )}
                >
                  {entry.direction === "in" ? "+" : "−"}
                  {formatMoney(entry.amount, business.currency)}
                </div>
                <RowMenu
                  label={entry.targetLabel ?? t.payments.title}
                  items={[
                    {
                      key: "cancel",
                      label: t.payments.cancelPaymentButton,
                      icon: <XCircleIcon className="size-4" />,
                      danger: true,
                      disabled: reverse.disabled,
                      disabledReason: reverse.reason,
                      onSelect: () => setModal({ type: "reverse", entry }),
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}

      {modal?.type === "reverse" ? (
        <ReversePaymentDialog
          key={`reverse-${modal.entry.id}`}
          payment={modal.entry}
          currency={business.currency}
          onClose={() => setModal(null)}
          onReversed={async () => {
            setModal(null);
            await refreshLedger();
            showToast("success", t.payments.toasts.reversed);
          }}
        />
      ) : null}

      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4"
      >
        {toast ? (
          <div
            className={cn(
              "pointer-events-auto flex items-center gap-2.5 rounded-full border px-5 py-3 text-sm font-medium shadow-phone backdrop-blur-xl",
              toast.kind === "success"
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "border-line bg-surface-raised text-foreground",
            )}
          >
            {toast.kind === "success" ? (
              <CheckCircleIcon className="size-4 shrink-0" />
            ) : (
              <AlertTriangleIcon className="size-4 shrink-0" />
            )}
            {toast.text}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LoadError() {
  const { t } = useI18n();
  return (
    <Card lift={false} className="relative overflow-hidden">
      <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
      <div className="relative flex flex-col items-center py-14 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground">
          <AlertTriangleIcon className="size-6" />
        </span>
        <h2 className="mt-5 font-display text-2xl font-light">
          {t.payments.loadError}
        </h2>
      </div>
    </Card>
  );
}
