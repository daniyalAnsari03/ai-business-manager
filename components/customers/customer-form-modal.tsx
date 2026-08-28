"use client";

import { useState, type FormEvent } from "react";
import {
  createCustomerAction,
  updateCustomerAction,
} from "@/app/actions/customers";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/input";
import type { Customer } from "@/lib/customers/types";
import {
  validateCustomerInput,
  type CustomerField,
  type CustomerFieldErrors,
} from "@/lib/customers/validation";
import type { Dictionary } from "@/lib/i18n/dictionary";

type CustomerFormModalProps = {
  /** Existing customer -> edit mode; omitted -> add mode. */
  customer?: Customer;
  onClose: () => void;
  onSaved: (customer: Customer, mode: "create" | "update") => void;
};

type ActionReason = keyof Dictionary["customers"]["form"]["errors"];

/**
 * Add/Edit customer dialog. Validation runs client-side for instant
 * feedback and is re-run authoritatively inside the server service.
 */
export function CustomerFormModal({
  customer,
  onClose,
  onSaved,
}: CustomerFormModalProps) {
  const { t } = useI18n();
  const isEdit = Boolean(customer);

  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [address, setAddress] = useState(customer?.address ?? "");
  const [notes, setNotes] = useState(customer?.notes ?? "");

  const [fieldErrors, setFieldErrors] = useState<CustomerFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function fieldErrorText(field: CustomerField): string | undefined {
    const code = fieldErrors[field];
    return code ? t.customers.form.fieldErrors[code] : undefined;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const validated = validateCustomerInput({
      name,
      phone,
      email,
      address,
      notes,
    });
    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors);
      return;
    }
    setFieldErrors({});
    setPending(true);

    const result = isEdit
      ? await updateCustomerAction(customer!.id, validated.value)
      : await createCustomerAction(validated.value);

    if (!result.ok) {
      setPending(false);
      setFormError(t.customers.form.errors[result.reason as ActionReason]);
      return;
    }

    onSaved(result.customer, isEdit ? "update" : "create");
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? t.customers.form.editTitle : t.customers.form.addTitle}
      description={
        isEdit
          ? t.customers.form.editDescription
          : t.customers.form.addDescription
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <TextField
          id="customer-name"
          label={t.customers.form.nameLabel}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t.customers.form.namePlaceholder}
          error={fieldErrorText("name")}
          maxLength={120}
          autoComplete="off"
          required
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id="customer-phone"
            label={t.customers.form.phoneLabel}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder={t.customers.form.phonePlaceholder}
            error={fieldErrorText("phone")}
            inputMode="tel"
            maxLength={30}
            autoComplete="off"
          />
          <TextField
            id="customer-email"
            label={t.customers.form.emailLabel}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t.customers.form.emailPlaceholder}
            error={fieldErrorText("email")}
            inputMode="email"
            maxLength={200}
            autoComplete="off"
          />
        </div>

        <TextField
          id="customer-address"
          label={t.customers.form.addressLabel}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={t.customers.form.addressPlaceholder}
          error={fieldErrorText("address")}
          maxLength={500}
          autoComplete="off"
        />

        <div className="w-full">
          <label
            htmlFor="customer-notes"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {t.customers.form.notesLabel}
          </label>
          <textarea
            id="customer-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t.customers.form.notesPlaceholder}
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
            {t.customers.form.cancelButton}
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
                {t.customers.form.savingButton}
              </>
            ) : (
              t.customers.form.saveButton
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
