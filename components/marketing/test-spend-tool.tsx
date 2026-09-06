"use client";

import { useState, type FormEvent } from "react";
import { simulateAdSpendAction } from "@/app/actions/wallet";
import { Spinner } from "@/components/customers/customer-form-modal";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";

type TestSpendToolProps = {
  /** Called after a successful spend so parents can refresh balance/history. */
  onSpend: () => void;
};

/**
 * DEBUG/VERIFICATION ONLY — clearly labelled test tool, not a real feature.
 *
 * Simulates an ad spend deduction so the ledger + balance math can be
 * verified before real ad spend exists (Phase 5). This component is only
 * rendered in a debug/test context (see WalletSection).
 *
 * REMOVE this component once real ad spend is connected to an actual ad
 * platform.
 */
export function TestSpendTool({ onSpend }: TestSpendToolProps) {
  const { t } = useI18n();
  const [amount, setAmount] = useState("");
  const [spending, setSpending] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);

  function validateAmount(raw: string): number | null {
    if (raw.trim() === "") return null;
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.round(num * 100) / 100;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const value = validateAmount(amount);
    if (value === null) {
      setMessage({ kind: "error", text: t.marketing.walletTestSpendFailed });
      return;
    }

    setSpending(true);
    try {
      const result = await simulateAdSpendAction(value);
      if (result.ok) {
        setMessage({
          kind: "success",
          text: `${t.marketing.walletTestSpendSuccess} ${t.marketing.walletTxTypeSpend}: ${value}`,
        });
        setAmount("");
        onSpend();
      } else if (result.reason === "insufficient_balance") {
        setMessage({
          kind: "error",
          text: t.marketing.walletTestSpendInsufficientBalance,
        });
      } else {
        setMessage({ kind: "error", text: t.marketing.walletTestSpendFailed });
      }
    } catch {
      setMessage({ kind: "error", text: t.marketing.walletTestSpendFailed });
    } finally {
      setSpending(false);
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/[0.04] px-4 py-4">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-300">
          <AlertTriangleIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
            {t.marketing.walletTestSpendTitle}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {t.marketing.walletTestSpendDescription}
          </p>

          <form
            onSubmit={handleSubmit}
            noValidate
            className="mt-3 flex flex-wrap items-end gap-3"
          >
            <label className="flex min-w-40 flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                {t.marketing.walletTestSpendAmountLabel}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setMessage(null);
                }}
                placeholder={t.marketing.walletTestSpendAmountPlaceholder}
                autoComplete="off"
                maxLength={14}
                disabled={spending}
                aria-invalid={message?.kind === "error"}
                className="min-h-11 w-full rounded-xl border border-line bg-surface-raised px-4 text-[15px] text-foreground placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
              />
            </label>
            <Button
              type="submit"
              size="lg"
              variant="secondary"
              disabled={spending || amount.trim() === ""}
            >
              {spending ? (
                <>
                  <Spinner />
                  {t.marketing.walletTestSpendProcessing}
                </>
              ) : (
                t.marketing.walletTestSpendButton
              )}
            </Button>
          </form>

          {message ? (
            <p
              role="status"
              className={cn(
                "mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed",
                message.kind === "error"
                  ? "text-muted"
                  : "font-medium text-emerald-700 dark:text-emerald-300",
              )}
            >
              {message.kind === "error" ? (
                <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
              ) : (
                <CheckCircleIcon className="mt-0.5 size-3.5 shrink-0" />
              )}
              {message.text}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
