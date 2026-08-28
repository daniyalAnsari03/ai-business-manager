"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { updateBusinessSettingsAction } from "@/app/actions/settings";
import { useI18n } from "@/components/i18n/language-provider";
import { Spinner } from "@/components/customers/customer-form-modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  GlobeIcon,
  LockIcon,
  SettingsIcon,
} from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select";
import { TextField } from "@/components/ui/input";
import {
  BUSINESS_TYPES,
  getCurrency,
} from "@/lib/business/constants";
import type { Language } from "@/lib/business/types";
import type { Business } from "@/lib/business/types";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { dictionaries } from "@/lib/i18n/dictionary";

type SettingsFormProps = {
  business: Business;
  userEmail: string | null;
};

type ActionReason = keyof Dictionary["settings"]["errors"];

/**
 * Business Settings form. Currency stays locked (chosen at setup) so past
 * reports keep meaning; language applies instantly and is persisted with
 * the profile on save. Ownership is derived server-side.
 */
export function SettingsForm({ business, userEmail }: SettingsFormProps) {
  const { t, setLanguage } = useI18n();
  const router = useRouter();

  const [name, setName] = useState(business.name);
  const [businessType, setBusinessType] = useState<Business["businessType"]>(
    business.businessType,
  );
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(
    business.language,
  );
  const [phone, setPhone] = useState(business.phone ?? "");
  const [address, setAddress] = useState(business.address ?? "");

  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const currency = getCurrency(business.currency);

  function handleLanguageChange(next: Language) {
    // Functional, not decorative — mirrors the setup flow: switching here
    // immediately re-renders the whole app; saving persists the choice.
    setSelectedLanguage(next);
    setLanguage(next);
    setSaved(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);

    if (name.trim().length < 2 || name.trim().length > 80) {
      setFormError(t.settings.errors.invalid_input);
      return;
    }

    setPending(true);
    try {
      const result = await updateBusinessSettingsAction({
        name: name.trim(),
        businessType,
        currency: business.currency,
        language: selectedLanguage,
        phone,
        address,
      });

      if (!result.ok) {
        setFormError(t.settings.errors[result.reason as ActionReason]);
        setPending(false);
        return;
      }

      setSaved(true);
      setPending(false);
      // Server components re-render with the saved business values.
      router.refresh();
    } catch {
      setFormError(t.settings.errors.database_error);
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <SettingsIcon className="size-3.5" />
            {t.nav.settings}
          </>
        }
        title={t.settings.title}
        subtitle={t.settings.subtitle}
      />

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {/* Business information */}
      <Card lift={false} className="relative overflow-hidden !p-6">
        <div aria-hidden className="ambient-glow -right-16 -top-24 size-[260px]" />
        <h2 className="relative text-sm font-medium uppercase tracking-widest text-faint">
          {t.settings.businessSection}
        </h2>

        <div className="relative mt-5 space-y-5">
          <TextField
            id="settings-name"
            label={t.settings.nameLabel}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            hint={t.settings.nameHint}
            maxLength={80}
            autoComplete="organization"
            required
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              id="settings-type"
              label={t.settings.typeLabel}
              value={businessType}
              onChange={(event) => {
                setBusinessType(event.target.value as Business["businessType"]);
                setSaved(false);
              }}
              required
            >
              {BUSINESS_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t.businessTypes[value]}
                </option>
              ))}
            </SelectField>

            {/* Locked currency */}
            <div className="w-full">
              <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
                {t.settings.currencyLabel}
                <LockIcon className="size-3.5 text-faint" aria-hidden />
              </span>
              <div
                aria-disabled
                className="flex min-h-12 w-full cursor-not-allowed items-center justify-between rounded-xl border border-line bg-surface-raised px-4 text-[15px] text-muted opacity-80"
              >
                <span>{currency ? `${currency.code} (${currency.symbol})` : business.currency}</span>
                <span className="text-xs text-faint">
                  {currency?.label ?? ""}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-faint">
                {t.settings.currencyHint}
              </p>
            </div>
          </div>

          {/* Language */}
          <fieldset>
            <legend className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <GlobeIcon className="size-4 text-faint" aria-hidden />
              {t.settings.languageLabel}
            </legend>
            <div className="grid max-w-md grid-cols-2 gap-3">
              {(Object.keys(dictionaries) as Language[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleLanguageChange(value)}
                  aria-pressed={selectedLanguage === value}
                  className={
                    selectedLanguage === value
                      ? "min-h-12 rounded-xl border border-emerald-500/50 bg-emerald-500/[0.1] px-4 text-sm font-medium text-accent transition-colors"
                      : "min-h-12 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-muted transition-colors hover:border-emerald-500/30 hover:text-foreground"
                  }
                >
                  {dictionaries[value].common.languageName}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-faint">
              {t.settings.languageHint}
            </p>
          </fieldset>

          <TextField
            id="settings-phone"
            label={t.settings.phoneLabel}
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setSaved(false);
            }}
            placeholder={t.settings.phonePlaceholder}
            inputMode="tel"
            maxLength={30}
            autoComplete="tel"
          />

          <TextField
            id="settings-address"
            label={t.settings.addressLabel}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setSaved(false);
            }}
            placeholder={t.settings.addressPlaceholder}
            maxLength={400}
            autoComplete="street-address"
          />
        </div>
      </Card>

      {/* Account */}
      <Card lift={false} className="!p-6">
        <h2 className="text-sm font-medium uppercase tracking-widest text-faint">
          {t.settings.accountSection}
        </h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
            <dt className="text-muted">{t.settings.accountEmailLabel}</dt>
            <dd className="truncate font-medium">{userEmail ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          {formError}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3 pb-2">
        {saved ? (
          <span
            role="status"
            className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300"
          >
            <CheckCircleIcon className="size-4 shrink-0" />
            {t.settings.savedToast}
          </span>
        ) : null}
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <>
              <Spinner />
              {t.settings.savingButton}
            </>
          ) : (
            t.settings.saveButton
          )}
        </Button>
      </div>
      </form>
    </div>
  );
}
