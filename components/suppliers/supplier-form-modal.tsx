"use client";

import { useState, type FormEvent } from "react";
import {
  createSupplierAction,
  updateSupplierAction,
} from "@/app/actions/suppliers";
import { useI18n } from "@/components/i18n/language-provider";
import { Spinner } from "@/components/customers/customer-form-modal";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/input";
import type { Supplier } from "@/lib/suppliers/types";
import {
  validateSupplierInput,
  type SupplierField,
} from "@/lib/suppliers/validation";
import type { Dictionary } from "@/lib/i18n/dictionary";

type SupplierFormModalProps = {
  supplier?: Supplier;
  onClose: () => void;
  onSaved: (supplier: Supplier, mode: "create" | "update") => void;
};

/** Add/edit supplier form. Validation runs here for feedback and again on the
 *  server, which is the only place ownership is decided. */
export function SupplierFormModal({
  supplier,
  onClose,
  onSaved,
}: SupplierFormModalProps) {
  const { t } = useI18n();
  const isEdit = Boolean(supplier);

  const [name, setName] = useState(supplier?.name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [paymentTerms, setPaymentTerms] = useState(supplier?.paymentTerms ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");

  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<SupplierField, keyof Dictionary["suppliers"]["form"]["fieldErrors"]>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function fieldErrorText(field: SupplierField): string | undefined {
    const code = fieldErrors[field];
    return code ? t.suppliers.form.fieldErrors[code] : undefined;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const validated = validateSupplierInput({
      name,
      phone,
      email,
      address,
      paymentTerms,
      notes,
    });
    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors);
      return;
    }
    setFieldErrors({});
    setPending(true);

    const result = isEdit
      ? await updateSupplierAction(supplier!.id, validated.value)
      : await createSupplierAction(validated.value);

    if (!result.ok) {
      setPending(false);
      setFormError(
        t.suppliers.form.errors[
          result.reason as keyof Dictionary["suppliers"]["form"]["errors"]
        ] ?? t.suppliers.form.errors.database_error,
      );
      return;
    }

    onSaved(result.supplier, isEdit ? "update" : "create");
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? t.suppliers.form.editTitle : t.suppliers.form.addTitle}
      description={
        isEdit ? t.suppliers.form.editDescription : t.suppliers.form.addDescription
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <TextField
          id="supplier-name"
          label={t.suppliers.form.nameLabel}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t.suppliers.form.namePlaceholder}
          error={fieldErrorText("name")}
          maxLength={120}
          autoComplete="off"
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id="supplier-phone"
            label={t.suppliers.form.phoneLabel}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder={t.suppliers.form.phonePlaceholder}
            error={fieldErrorText("phone")}
            inputMode="tel"
            maxLength={30}
            autoComplete="off"
          />
          <TextField
            id="supplier-email"
            label={t.suppliers.form.emailLabel}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t.suppliers.form.emailPlaceholder}
            error={fieldErrorText("email")}
            inputMode="email"
            maxLength={200}
            autoComplete="off"
          />
        </div>

        <TextField
          id="supplier-address"
          label={t.suppliers.form.addressLabel}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          error={fieldErrorText("address")}
          maxLength={500}
          autoComplete="off"
        />

        <TextField
          id="supplier-payment-terms"
          label={t.suppliers.form.paymentTermsLabel}
          value={paymentTerms}
          onChange={(event) => setPaymentTerms(event.target.value)}
          placeholder={t.suppliers.form.paymentTermsPlaceholder}
          error={fieldErrorText("paymentTerms")}
          maxLength={200}
          autoComplete="off"
        />

        <div className="w-full">
          <label
            htmlFor="supplier-notes"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {t.suppliers.form.notesLabel}
          </label>
          <textarea
            id="supplier-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t.suppliers.form.notesPlaceholder}
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
            {t.suppliers.form.cancelButton}
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
                {t.suppliers.form.savingButton}
              </>
            ) : (
              t.suppliers.form.saveButton
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
