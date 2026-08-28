"use client";

import { useMemo, useState, type FormEvent } from "react";
import { createOrderAction } from "@/app/actions/orders";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select";
import { TextField } from "@/components/ui/input";
import type { CurrencyCode } from "@/lib/business/constants";
import { formatMoney } from "@/lib/format/currency";
import {
  validateOrderInput,
  type OrderField,
  type OrderFieldErrors,
} from "@/lib/orders/validation";
import type { OrderWithItems } from "@/lib/orders/types";
import type { Product } from "@/lib/products/types";
import type { Dictionary } from "@/lib/i18n/dictionary";

type CustomerOption = { id: string; name: string };

type OrderFormModalProps = {
  products: Product[];
  customers: CustomerOption[];
  currency: CurrencyCode;
  onClose: () => void;
  onCreated: (order: OrderWithItems) => void;
};

type ActionReason = keyof Dictionary["orders"]["create"]["errors"];

type ItemLine = { key: number; productId: string; quantity: string };

let lineKey = 0;

/**
 * New order dialog. The client shows indicative totals only — prices and
 * totals are computed authoritatively inside the database function, so the
 * displayed numbers can never diverge from what is actually saved.
 */
export function OrderFormModal({
  products,
  customers,
  currency,
  onClose,
  onCreated,
}: OrderFormModalProps) {
  const { t } = useI18n();

  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<ItemLine[]>([
    { key: ++lineKey, productId: "", quantity: "1" },
  ]);
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [orderedAt, setOrderedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  const [fieldErrors, setFieldErrors] = useState<OrderFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const totals = useMemo(() => {
    let subtotal = 0;
    for (const line of lines) {
      const product = line.productId ? productById.get(line.productId) : null;
      if (!product) continue;
      const quantity = Number.parseInt(line.quantity, 10);
      if (Number.isFinite(quantity) && quantity > 0) {
        subtotal += product.price * quantity;
      }
    }
    const parsedDiscount = Number.parseFloat(discount.replace(/,/g, ""));
    const safeDiscount =
      Number.isFinite(parsedDiscount) && parsedDiscount > 0 ? parsedDiscount : 0;
    return {
      subtotal,
      discount: Math.min(safeDiscount, subtotal),
      total: Math.max(0, subtotal - Math.min(safeDiscount, subtotal)),
    };
  }, [lines, productById, discount]);

  function fieldErrorText(field: OrderField): string | undefined {
    const code = fieldErrors[field];
    return code
      ? t.orders.create.fieldErrors[code as keyof typeof t.orders.create.fieldErrors]
      : undefined;
  }

  function updateLine(key: number, patch: Partial<ItemLine>) {
    setFieldErrors((current) => ({ ...current, items: undefined }));
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    setLines((current) => [
      ...current,
      { key: ++lineKey, productId: "", quantity: "1" },
    ]);
  }

  function removeLine(key: number) {
    setLines((current) =>
      current.length > 1
        ? current.filter((line) => line.key !== key)
        : current,
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const validated = validateOrderInput({
      customerId: customerId || null,
      discount: discount,
      notes,
      orderedAt: orderedAt || null,
      items: lines
        .filter((line) => line.productId)
        .map((line) => ({
          productId: line.productId,
          quantity: Number(line.quantity),
        })),
    });

    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors);
      return;
    }
    setFieldErrors({});
    setPending(true);

    const result = await createOrderAction(validated.value);
    if (!result.ok) {
      setPending(false);
      setFormError(t.orders.create.errors[result.reason as ActionReason]);
      return;
    }

    onCreated(result.order);
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t.orders.create.title}
      description={t.orders.create.description}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <SelectField
          id="order-customer"
          label={t.orders.create.customerLabel}
          value={customerId}
          onChange={(event) => {
            setCustomerId(event.target.value);
            setFieldErrors((current) => ({ ...current, customer: undefined }));
          }}
          error={fieldErrorText("customer")}
        >
          <option value="">{t.orders.create.customerAnyOption}</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </SelectField>

        {/* Items */}
        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-medium text-foreground">
            {t.orders.create.itemsHeading}
            <span aria-hidden className="ml-0.5 text-accent">
              *
            </span>
          </legend>

          {fieldErrors.items ? (
            <p role="alert" className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
              <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
              {fieldErrorText("items")}
            </p>
          ) : null}

          {lines.map((line) => {
            const selected = line.productId
              ? productById.get(line.productId)
              : null;
            const chosenIds = new Set(
              lines.filter((l) => l.key !== line.key).map((l) => l.productId),
            );
            return (
              <div
                key={line.key}
                className="flex flex-col gap-2 rounded-xl border border-line bg-surface-raised p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <select
                    aria-label={`${t.orders.create.itemsHeading} ${lines.indexOf(line) + 1}`}
                    value={line.productId}
                    onChange={(event) =>
                      updateLine(line.key, { productId: event.target.value })
                    }
                    className="min-h-11 w-full appearance-none rounded-lg border border-line bg-surface px-3 pr-9 text-sm text-foreground shadow-card transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
                    style={{
                      backgroundImage:
                        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 0.65rem center",
                    }}
                  >
                    <option value="">
                      {t.orders.create.itemProductPlaceholder}
                    </option>
                    {products.map((product) => (
                      <option
                        key={product.id}
                        value={product.id}
                        disabled={chosenIds.has(product.id)}
                      >
                        {product.name}
                        {` — ${product.stockQuantity}`}
                      </option>
                    ))}
                  </select>
                  {selected ? (
                    <p className="mt-1 px-1 text-xs text-faint tabular-nums">
                      {selected.price.toLocaleString("en-US")} ×{" "}
                      {t.orders.details.itemsHeading.toLowerCase()}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    aria-label={t.orders.create.itemQuantityAria}
                    value={line.quantity}
                    onChange={(event) =>
                      updateLine(line.key, { quantity: event.target.value })
                    }
                    className="min-h-11 w-20 rounded-lg border border-line bg-surface px-3 text-center text-sm font-medium tabular-nums text-foreground shadow-card transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    aria-label={t.orders.create.itemRemove}
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-foreground/[0.08] hover:text-foreground min-touch-target"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </div>
              </div>
            );
          })}

          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={addLine}
            disabled={lines.length >= 50}
          >
            <PlusIcon className="size-4" />
            {t.orders.create.addItemButton}
          </Button>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id="order-discount"
            label={t.orders.create.discountLabel}
            value={discount}
            onChange={(event) => {
              setDiscount(event.target.value);
              setFieldErrors((current) => ({ ...current, discount: undefined }));
            }}
            placeholder="0"
            hint={t.orders.create.discountHint}
            error={fieldErrorText("discount")}
            inputMode="decimal"
            autoComplete="off"
          />
          <TextField
            id="order-date"
            label={t.orders.create.dateLabel}
            type="date"
            value={orderedAt}
            onChange={(event) => setOrderedAt(event.target.value)}
            error={fieldErrorText("orderedAt")}
            required
          />
        </div>

        <div className="w-full">
          <label
            htmlFor="order-notes"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {t.orders.create.notesLabel}
          </label>
          <textarea
            id="order-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t.orders.create.notesPlaceholder}
            rows={2}
            maxLength={2000}
            className="min-h-[4.5rem] w-full resize-y rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-foreground shadow-card transition-colors duration-200 placeholder:text-faint hover:border-emerald-500/30 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
          />
        </div>

        {/* Indicative totals */}
        <div className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm shadow-card">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted">{t.orders.create.subtotalLabel}</span>
            <span className="tabular-nums">
              {formatMoney(totals.subtotal, currency)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-4">
            <span className="text-muted">{t.orders.create.discountLabel}</span>
            <span className="tabular-nums">
              −{formatMoney(totals.discount, currency)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-4 border-t border-line pt-2">
            <span className="font-medium">{t.orders.create.totalLabel}</span>
            <span className="font-display text-lg font-light tabular-nums">
              {formatMoney(totals.total, currency)}
            </span>
          </div>
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
            {t.orders.create.cancelButton}
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
                {t.orders.create.savingButton}
              </>
            ) : (
              t.orders.create.saveButton
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
