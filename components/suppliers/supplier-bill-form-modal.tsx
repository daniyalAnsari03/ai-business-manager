"use client";

import { useState, type FormEvent } from "react";
import {
  createSupplierBillAction,
  updateSupplierBillAction,
} from "@/app/actions/supplier-bills";
import { useI18n } from "@/components/i18n/language-provider";
import { Spinner } from "@/components/customers/customer-form-modal";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import type { CurrencyCode } from "@/lib/business/constants";
import { formatMoney } from "@/lib/format/currency";
import type {
  SupplierBill,
  SupplierBillWithDetails,
} from "@/lib/supplier-bills/types";
import {
  validateSupplierBillInput,
  type SupplierBillField,
} from "@/lib/supplier-bills/validation";
import type { Dictionary } from "@/lib/i18n/dictionary";

type SupplierOption = { id: string; name: string };

function todayIsoDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

/** Creates or edits a supplier bill through the wrapper RPCs. */
export function SupplierBillFormModal({
  suppliers,
  defaultSupplierId,
  bill,
  currency,
  onClose,
  onSaved,
}: {
  suppliers: SupplierOption[];
  defaultSupplierId?: string;
  bill?: SupplierBillWithDetails;
  currency: CurrencyCode;
  onClose: () => void;
  onSaved: (bill: SupplierBill, mode: "create" | "update") => void;
}) {
  const { t } = useI18n();
  const isEdit = Boolean(bill);

  const [supplierId, setSupplierId] = useState(
    bill?.supplierId ?? defaultSupplierId ?? suppliers[0]?.id ?? "",
  );
  const [billNumber, setBillNumber] = useState(bill?.billNumber ?? "");
  const [billDate, setBillDate] = useState(
    bill?.billDate?.slice(0, 10) ?? todayIsoDate(),
  );
  const [dueDate, setDueDate] = useState(bill?.dueDate?.slice(0, 10) ?? "");
  const [subtotal, setSubtotal] = useState(bill ? String(bill.subtotal) : "");
  const [discount, setDiscount] = useState(
    bill && bill.discount ? String(bill.discount) : "0",
  );
  const [notes, setNotes] = useState(bill?.notes ?? "");

  const [fieldErrors, setFieldErrors] = useState<
    Partial<
      Record<
        SupplierBillField,
        keyof Dictionary["supplierBills"]["create"]["fieldErrors"]
      >
    >
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const subtotalNumber = Number(subtotal.replace(/,/g, "").trim());
  const discountNumber = Number(discount.replace(/,/g, "").trim()) || 0;
  const previewTotal =
    Number.isFinite(subtotalNumber) && subtotalNumber > 0
      ? Math.max(subtotalNumber - discountNumber, 0)
      : 0;

  function fieldErrorText(field: SupplierBillField): string | undefined {
    const code = fieldErrors[field];
    return code ? t.supplierBills.create.fieldErrors[code] : undefined;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const validated = validateSupplierBillInput({
      supplierId,
      subtotal: subtotalNumber,
      discount: discountNumber,
      billNumber,
      billDate,
      dueDate,
      notes,
    });
    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors);
      return;
    }
    setFieldErrors({});
    setPending(true);

    const result = isEdit
      ? await updateSupplierBillAction(bill!.id, validated.value)
      : await createSupplierBillAction(validated.value);

    if (!result.ok) {
      setPending(false);
      setFormError(
        t.supplierBills.create.errors[
          result.reason as keyof Dictionary["supplierBills"]["create"]["errors"]
        ] ?? t.supplierBills.create.errors.database_error,
      );
      return;
    }

    onSaved(result.bill, isEdit ? "update" : "create");
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        isEdit ? t.supplierBills.create.editTitle : t.supplierBills.create.title
      }
      description={t.supplierBills.create.description}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <SelectField
          id="bill-supplier"
          label={t.supplierBills.create.supplierLabel}
          value={supplierId}
          onChange={(event) => setSupplierId(event.target.value)}
          disabled={isEdit}
        >
          <option value="">{t.supplierBills.create.supplierPlaceholder}</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </SelectField>

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id="bill-number"
            label={t.supplierBills.create.billNumberLabel}
            value={billNumber}
            onChange={(event) => setBillNumber(event.target.value)}
            placeholder={t.supplierBills.create.billNumberPlaceholder}
            error={fieldErrorText("billNumber")}
            maxLength={60}
            autoComplete="off"
          />
          <TextField
            id="bill-date"
            label={t.supplierBills.create.billDateLabel}
            type="date"
            value={billDate}
            onChange={(event) => setBillDate(event.target.value)}
            error={fieldErrorText("billDate")}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id="bill-due-date"
            label={t.supplierBills.create.dueDateLabel}
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            error={fieldErrorText("dueDate")}
          />
          <TextField
            id="bill-subtotal"
            label={t.supplierBills.create.subtotalLabel}
            value={subtotal}
            onChange={(event) => setSubtotal(event.target.value)}
            error={fieldErrorText("subtotal")}
            inputMode="decimal"
            autoComplete="off"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id="bill-discount"
            label={t.supplierBills.create.discountLabel}
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
            error={fieldErrorText("discount")}
            inputMode="decimal"
            autoComplete="off"
          />
          <div className="flex items-end">
            <div className="w-full rounded-xl border border-line bg-surface-raised px-4 py-3">
              <p className="text-xs uppercase tracking-widest text-faint">
                {t.supplierBills.create.totalLabel}
              </p>
              <p className="mt-1 font-display text-xl font-light tabular-nums">
                {formatMoney(previewTotal, currency)}
              </p>
            </div>
          </div>
        </div>

        <div className="w-full">
          <label
            htmlFor="bill-notes"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {t.supplierBills.create.notesLabel}
          </label>
          <textarea
            id="bill-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={2000}
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
            {t.supplierBills.create.cancelButton}
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
                {t.supplierBills.create.savingButton}
              </>
            ) : (
              t.supplierBills.create.saveButton
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
