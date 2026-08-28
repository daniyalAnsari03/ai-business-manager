"use client";

import { useState } from "react";
import { adjustProductStockAction } from "@/app/actions/inventory";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import type { StockActionError } from "@/app/actions/inventory";
import type { Product } from "@/lib/products/types";
import { cn } from "@/lib/utils";

type StockAdjustModalProps = {
  product: Product;
  onClose: () => void;
  onSaved: (product: Product) => void;
};

type Mode = "add" | "remove";

/**
 * Signed stock adjustment (Inventory module): add or remove an amount on
 * top of the current stock. The delta is applied atomically server-side —
 * removing more than exists is refused by the database function.
 */
export function StockAdjustModal({
  product,
  onClose,
  onSaved,
}: StockAdjustModalProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("add");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const parsedAmount = Number.parseInt(amount, 10);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const projected =
    validAmount === false
      ? null
      : mode === "add"
        ? product.stockQuantity + parsedAmount
        : product.stockQuantity - parsedAmount;

  async function handleSubmit() {
    setFormError(null);

    if (!validAmount) {
      setError(t.inventory.errors.invalid_input);
      return;
    }
    if (projected !== null && projected < 0) {
      setError(t.inventory.errors.insufficient_stock);
      return;
    }
    setError(null);
    setPending(true);

    const delta = mode === "add" ? parsedAmount : -parsedAmount;
    const result = await adjustProductStockAction(product.id, delta);
    if (!result.ok) {
      setPending(false);
      setFormError(
        t.inventory.errors[result.reason as StockActionError] ??
          t.inventory.errors.database_error,
      );
      return;
    }

    onSaved(result.product);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t.inventory.adjustModal.title}
      description={product.name}
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm shadow-card">
          <span className="text-muted">{t.inventory.adjustModal.currentLabel}: </span>
          <span className="font-medium tabular-nums">
            {product.stockQuantity.toLocaleString("en-US")}
          </span>
        </div>

        {/* Direction */}
        <div className="grid grid-cols-2 gap-3">
          {(["add", "remove"] as Mode[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value);
                setError(null);
              }}
              aria-pressed={mode === value}
              className={cn(
                "min-h-12 rounded-xl border px-4 text-sm font-medium transition-colors",
                mode === value
                  ? value === "add"
                    ? "border-emerald-500/50 bg-emerald-500/[0.1] text-accent"
                    : "border-faint/70 bg-foreground/[0.07] text-foreground"
                  : "border-line bg-surface text-muted hover:border-emerald-500/30 hover:text-foreground",
              )}
            >
              {value === "add"
                ? t.inventory.adjustModal.modeAdd
                : t.inventory.adjustModal.modeRemove}
            </button>
          ))}
        </div>

        {/* Amount */}
        <div>
          <label
            htmlFor="stock-adjust-amount"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {t.inventory.adjustModal.amountLabel}
          </label>
          <input
            id="stock-adjust-amount"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "stock-adjust-error" : undefined}
            disabled={pending}
            className={cn(
              "min-h-12 w-full rounded-xl border bg-surface px-4 text-center text-lg font-medium tabular-nums text-foreground shadow-card transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/25",
              error
                ? "border-faint"
                : "border-line focus:border-emerald-500/50",
            )}
          />
          {error ? (
            <p
              id="stock-adjust-error"
              role="alert"
              className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted"
            >
              <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}
        </div>

        {/* Live preview of the resulting stock */}
        {projected !== null ? (
          <div
            className={cn(
              "flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm",
              projected < 0
                ? "border-faint/70 bg-surface-raised"
                : "border-line bg-surface-raised",
            )}
          >
            <span className="text-muted">{t.inventory.adjustModal.resultPrefix}</span>
            <span className="font-medium tabular-nums">
              {projected.toLocaleString("en-US")}
            </span>
          </div>
        ) : null}

        {formError ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted"
          >
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
            {formError}
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
            {t.inventory.adjustModal.cancelButton}
          </Button>
          <Button size="lg" onClick={handleSubmit} disabled={pending} className="w-full sm:w-auto">
            {pending ? (
              <>
                <Spinner />
                {t.inventory.adjustModal.savingButton}
              </>
            ) : (
              t.inventory.adjustModal.saveButton
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
    />
  );
}
