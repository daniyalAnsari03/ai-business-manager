"use client";

import { useState, type FormEvent } from "react";
import { updateStockAction } from "@/app/actions/products";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import {
  AlertCircleIcon,
  MinusIcon,
  PlusIcon,
} from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import type { Product } from "@/lib/products/types";
import { validateStockValue, type ProductFieldError } from "@/lib/products/validation";
import type { Dictionary } from "@/lib/i18n/dictionary";

type StockUpdateModalProps = {
  product: Product;
  onClose: () => void;
  onSaved: (product: Product) => void;
};

/**
 * Manual stock update (AGENTS.md §11): current stock -> new stock -> save.
 * Negative or non-integer values are rejected on both sides. Automatic
 * order-based deduction arrives with the Orders phase.
 */
export function StockUpdateModal({
  product,
  onClose,
  onSaved,
}: StockUpdateModalProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(String(product.stockQuantity));
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function errorText(code: ProductFieldError): string {
    return t.products.form.fieldErrors[code];
  }

  function stepBy(delta: number) {
    setError(null);
    setValue((current) => {
      const parsed = Number.parseInt(current, 10);
      const base = Number.isFinite(parsed) ? parsed : 0;
      return String(Math.max(0, base + delta));
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const validated = validateStockValue(value);
    if (!validated.ok) {
      setError(errorText(validated.error));
      return;
    }
    setError(null);
    setPending(true);

    const result = await updateStockAction(product.id, validated.stockQuantity);
    if (!result.ok) {
      setPending(false);
      setFormError(
        t.products.form.errors[result.reason as keyof Dictionary["products"]["form"]["errors"]],
      );
      return;
    }

    onSaved(result.product);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t.products.stockModal.title}
      description={product.name}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <div className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm shadow-card">
          <span className="text-muted">{t.products.stockModal.currentLabel}: </span>
          <span className="font-medium">
            {product.stockQuantity.toLocaleString("en-US")} {t.products.pcsUnit}
          </span>
        </div>

        {/* Stepper */}
        <div>
          <label
            htmlFor="stock-value"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {t.products.stockModal.newLabel}
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => stepBy(-1)}
              aria-label={t.products.stockModal.decrease}
              disabled={pending}
              className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-muted shadow-card transition-colors hover:border-emerald-500/40 hover:text-accent disabled:pointer-events-none disabled:opacity-60"
            >
              <MinusIcon className="size-4" />
            </button>
            <input
              id="stock-value"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={value}
              onChange={(event) => {
                setError(null);
                setValue(event.target.value);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "stock-value-error" : undefined}
              disabled={pending}
              className={`min-h-12 w-full rounded-xl border bg-surface px-4 text-center text-lg font-medium text-foreground shadow-card transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 ${
                error ? "border-faint" : "border-line focus:border-emerald-500/50"
              }`}
            />
            <button
              type="button"
              onClick={() => stepBy(1)}
              aria-label={t.products.stockModal.increase}
              disabled={pending}
              className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-muted shadow-card transition-colors hover:border-emerald-500/40 hover:text-accent disabled:pointer-events-none disabled:opacity-60"
            >
              <PlusIcon className="size-4" />
            </button>
          </div>
          {error ? (
            <p
              id="stock-value-error"
              role="alert"
              className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted"
            >
              <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}
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

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={onClose}
            disabled={pending}
            className="w-full sm:w-auto"
          >
            {t.products.form.cancelButton}
          </Button>
          <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
            {pending ? (
              <>
                <Spinner />
                {t.products.stockModal.savingButton}
              </>
            ) : (
              t.products.stockModal.saveButton
            )}
          </Button>
        </div>
      </form>
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
