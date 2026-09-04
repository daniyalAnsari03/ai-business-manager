"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  PlusIcon,
  WalletIcon,
} from "@/components/ui/icons";
import { TransactionHistory } from "@/components/marketing/transaction-history";
import { TestSpendTool } from "@/components/marketing/test-spend-tool";
import { initiateWalletTopupAction } from "@/app/actions/wallet";
import type { CurrencyCode } from "@/lib/business/constants";
import type { Business } from "@/lib/business/types";
import { formatMoney } from "@/lib/format/currency";
import type { WalletTransaction } from "@/lib/marketing/types";
import { cn } from "@/lib/utils";

type WalletSectionProps = {
  business: Business;
  initialBalance: number;
  /** Monthly ad budget cap (currency amount) or null when unset. */
  monthlyBudgetCap: number | null;
  initialTransactions: WalletTransaction[];
  /** Whether a live payment provider is configured (server-derived). */
  paymentProviderAvailable: boolean;
  /** Whether the server-side load of wallet data failed. */
  walletLoadFailed?: boolean;
  /** Whether to show the debug test-spend tool (gated by parent/server). */
  showTestSpend?: boolean;
};

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

/**
 * Wallet dashboard — balance display, top-up (gated on a payment provider),
 * transaction history from the real ledger, and an optional debug test-spend
 * tool. Reads from real wallet + wallet_transactions data; never fabricates
 * balances or transactions.
 */
export function WalletSection({
  business,
  initialBalance,
  monthlyBudgetCap,
  initialTransactions,
  paymentProviderAvailable,
  walletLoadFailed = false,
  showTestSpend = false,
}: WalletSectionProps) {
  const { t } = useI18n();
  const router = useRouter();

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [topupMessage, setTopupMessage] = useState<{
    kind: "error" | "info";
    text: string;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const currency = business.currency as CurrencyCode;

  /**
   * After a wallet mutation (e.g. test spend), re-read the latest balance and
   * transaction history from the server. Using router.refresh() re-runs the
   * server component so BOTH balance and ledger stay in sync with the DB.
   */
  const refreshWallet = () => {
    router.refresh();
  };

  // Auto-dismiss top-up info message.
  useEffect(() => {
    if (!topupMessage) return;
    const timer = window.setTimeout(() => setTopupMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [topupMessage]);

  function handleQuickAmount(amount: number) {
    setSelectedAmount(amount);
    setCustomAmount("");
    setTopupMessage(null);
  }

  function handleCustomAmount(value: string) {
    setCustomAmount(value);
    setSelectedAmount(null);
    setTopupMessage(null);
  }

  function resolveAmount(): number | null {
    if (selectedAmount !== null) return selectedAmount;
    if (!/^\d+(\.\d{1,2})?$/.test(customAmount.trim())) return null;
    const num = Number(customAmount);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.round(num * 100) / 100;
  }

  /**
   * Initiates a real payment checkout session server-side and redirects
   * the user to the hosted checkout page.
   */
  async function handleTopup() {
    setTopupMessage(null);
    if (!paymentProviderAvailable) {
      setTopupMessage({ kind: "error", text: t.marketing.walletNoProviderHint });
      return;
    }

    const amount = resolveAmount();
    if (amount === null) {
      setTopupMessage({ kind: "error", text: t.marketing.walletTopupFailed });
      return;
    }

    setIsProcessing(true);

    try {
      const result = await initiateWalletTopupAction(amount);

      if (result.ok) {
        // Redirect to the provider's hosted checkout (full page redirect).
        window.location.href = result.checkoutUrl;
        return;
      }

      setTopupMessage({
        kind: "error",
        text: t.marketing.walletTopupFailed,
      });
    } catch {
      setTopupMessage({
        kind: "error",
        text: t.marketing.walletTopupFailed,
      });
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <Card lift={false} className="relative overflow-hidden !p-6">
      <div aria-hidden className="ambient-glow -right-16 -top-24 size-[260px]" />
      <div className="relative">
        {/* Header */}
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-accent">
            <WalletIcon className="size-[18px]" />
          </span>
          <div>
            <h2 className="text-sm font-medium uppercase tracking-widest text-faint">
              {t.marketing.walletTitle}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t.marketing.walletBalanceHint}
            </p>
          </div>
        </div>

        {walletLoadFailed ? (
          <p
            role="alert"
            className="mt-4 flex items-start gap-1.5 text-xs leading-relaxed text-muted"
          >
            <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
            {t.marketing.activityLoadError}
          </p>
        ) : (
          <>
            {/* Balance */}
            <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-faint">
                  {t.marketing.walletBalance}
                </p>
                <p className="mt-1 font-display text-4xl font-light tabular-nums text-foreground">
                  {formatMoney(initialBalance, currency)}
                </p>
                <p className="mt-1 text-xs text-faint">
                  {t.marketing.walletMonthlyBudget}:{" "}
                  {monthlyBudgetCap == null
                    ? t.marketing.walletNoBudget
                    : formatMoney(monthlyBudgetCap, currency)}
                </p>
              </div>
            </div>

            {/* Top-up */}
            <div className="mt-6 border-t border-line pt-5">
              <div className="flex items-center gap-2">
                <PlusIcon className="size-4 text-faint" />
                <h3 className="text-sm font-medium">{t.marketing.walletTopupTitle}</h3>
              </div>

              {paymentProviderAvailable ? (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {QUICK_AMOUNTS.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => handleQuickAmount(amount)}
                        aria-pressed={selectedAmount === amount}
                        className={cn(
                          "min-h-11 rounded-xl border px-3 text-sm font-medium transition-colors",
                          selectedAmount === amount
                            ? "border-emerald-500/50 bg-emerald-500/[0.1] text-accent"
                            : "border-line bg-surface text-muted hover:border-emerald-500/30 hover:text-foreground",
                        )}
                      >
                        {formatMoney(amount, currency)}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="flex min-w-44 flex-1 flex-col gap-1.5">
                      <span className="text-xs font-medium text-foreground">
                        {t.marketing.walletCustomAmount}
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={customAmount}
                        onChange={(event) => handleCustomAmount(event.target.value)}
                        placeholder={t.marketing.walletCustomAmount}
                        autoComplete="off"
                        maxLength={14}
                        className="min-h-11 w-full rounded-xl border border-line bg-surface-raised px-4 text-[15px] text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
                      />
                    </label>
                    <div className="flex min-h-11 items-center pb-px">
                      <Button
                        type="button"
                        size="lg"
                        onClick={handleTopup}
                        disabled={resolveAmount() === null || isProcessing}
                      >
                        {isProcessing
                          ? t.marketing.walletTopupProcessing
                          : t.marketing.walletTopupButton}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div
                  className={cn(
                    "mt-4 flex items-start gap-2.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted",
                  )}
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">
                      {t.marketing.walletTopupDisabled}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-faint">
                      {t.marketing.walletNoProviderHint}
                    </p>
                  </div>
                </div>
              )}

              {topupMessage ? (
                <p
                  role="status"
                  className={cn(
                    "mt-3 flex items-start gap-1.5 text-xs leading-relaxed",
                    topupMessage.kind === "error"
                      ? "text-muted"
                      : "font-medium text-emerald-700 dark:text-emerald-300",
                  )}
                >
                  {topupMessage.kind === "error" ? (
                    <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
                  ) : (
                    <CheckCircleIcon className="mt-0.5 size-3.5 shrink-0" />
                  )}
                  {topupMessage.text}
                </p>
              ) : null}
            </div>

            {/* Transaction history */}
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="text-sm font-medium">
                {t.marketing.walletHistoryTitle}
              </h3>
              <div className="mt-3 -mx-4">
                <TransactionHistory
                  transactions={initialTransactions}
                  currency={currency}
                />
              </div>
            </div>

            {/* Debug test-spend tool — gated */}
            {showTestSpend ? (
              <div className="mt-6 border-t border-line pt-5">
                <TestSpendTool onSpend={refreshWallet} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
