"use client";

import type { WalletTransaction } from "@/lib/marketing/types";
import type { CurrencyCode } from "@/lib/business/constants";
import { formatMoney } from "@/lib/format/currency";
import { formatDateTime } from "@/lib/format/date";
import { useI18n } from "@/components/i18n/language-provider";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  TrendingUpIcon,
  WalletIcon,
  PlusIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionary";

type TransactionHistoryProps = {
  transactions: WalletTransaction[];
  currency: CurrencyCode;
  /** string so rows show a localized "No cap"/empty when relevant. */
  loadFailed?: boolean;
};

/**
 * Recent wallet transaction ledger. Pure list — no fetching, data is passed
 * in. Shows type, amount signed by type, balance after, status and date.
 */
export function TransactionHistory({
  transactions,
  currency,
  loadFailed = false,
}: TransactionHistoryProps) {
  const { t } = useI18n();

  if (loadFailed) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted">
        <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
        {t.marketing.activityLoadError}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
          <WalletIcon className="size-5" />
        </span>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
          {t.marketing.walletHistoryEmpty}
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {transactions.map((tx) => (
        <TransactionRow key={tx.id} transaction={tx} currency={currency} />
      ))}
    </ul>
  );
}

function TransactionRow({
  transaction,
  currency,
}: {
  transaction: WalletTransaction;
  currency: CurrencyCode;
}) {
  const { t, language } = useI18n();

  const isTopup = transaction.type === "topup";
  const isAdjustment = transaction.type === "adjustment";

  const icon = isTopup ? (
    <PlusIcon className="size-3.5" />
  ) : isAdjustment ? (
    <TrendingUpIcon className="size-3.5" />
  ) : (
    <WalletIcon className="size-3.5" />
  );

  const iconClass = isTopup
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
    : isAdjustment
      ? "bg-blue-500/10 text-blue-600 dark:text-blue-300"
      : "bg-amber-500/10 text-amber-600 dark:text-amber-300";

  const sign = isTopup ? "+" : "-";
  const amountText = `${sign} ${formatMoney(transaction.amount, currency)}`;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          iconClass,
        )}
      >
        {icon}
      </span>

      <div className="min-w-[10rem] flex-1">
        <p className="truncate text-sm font-medium capitalize">
          {typeLabel(t, transaction.type)}
        </p>
        <p className="mt-0.5 truncate text-xs text-faint">
          {formatDateTime(transaction.createdAt, language)}
          {transaction.description ? ` · ${transaction.description}` : ""}
        </p>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
        <div className="flex flex-col items-end gap-1">
          <span
            className={cn(
              "text-sm font-medium tabular-nums",
              isTopup ? "text-emerald-600 dark:text-emerald-300" : "text-foreground",
            )}
          >
            {amountText}
          </span>
          <span className="text-[11px] text-faint">
            {t.marketing.walletBalanceAfter}:{" "}
            {formatMoney(transaction.balanceAfter, currency)}
          </span>
        </div>

        <StatusBadge status={transaction.status} />
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: WalletTransaction["status"] }) {
  const { t } = useI18n();

  if (status === "completed") {
    return (
      <span
        role="status"
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-300"
      >
        <CheckCircleIcon className="size-3" />
        {t.marketing.walletTxStatusCompleted}
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span
        role="status"
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300"
      >
        <ClockIcon className="size-3" />
        {t.marketing.walletTxStatusPending}
      </span>
    );
  }

  return (
    <span
      role="status"
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-300"
    >
      <AlertCircleIcon className="size-3" />
      {t.marketing.walletTxStatusFailed}
    </span>
  );
}

function typeLabel(t: Dictionary, type: WalletTransaction["type"]): string {
  switch (type) {
    case "topup":
      return t.marketing.walletTxTypeTopup;
    case "spend":
      return t.marketing.walletTxTypeSpend;
    case "adjustment":
      return t.marketing.walletTxTypeAdjustment;
  }
}
