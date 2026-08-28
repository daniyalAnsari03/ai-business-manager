"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { startTransition, useEffect, useState, type FormEvent } from "react";
import { completeBusinessSetupAction } from "@/app/actions/business";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  GlobeIcon,
  StoreIcon,
} from "@/components/ui/icons";
import { SelectField } from "@/components/ui/select";
import { TextField } from "@/components/ui/input";
import {
  BUSINESS_TYPES,
  CURRENCIES,
} from "@/lib/business/constants";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { Language } from "@/lib/business/types";
import { cn } from "@/lib/utils";

const NAME_MIN = 2;
const NAME_MAX = 80;
const TOTAL_STEPS = 3;

/** Safety net: if client-side routing stalls after setup, force a full load. */
const REDIRECT_FALLBACK_MS = 2500;

/**
 * First-time Business Setup as a short three-step flow:
 * 1. Business name
 * 2. Business type
 * 3. Preferred language (+ currency for reports)
 * Everything is saved through the same guarded server action as before.
 */
export function BusinessSetupForm() {
  const { t, language, setLanguage } = useI18n();
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>("PKR");
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();
  const [typeError, setTypeError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  function validateName(): boolean {
    const trimmedName = name.trim();
    if (trimmedName.length < NAME_MIN || trimmedName.length > NAME_MAX) {
      setNameError(
        language === "ur"
          ? `Business ka naam ${NAME_MIN} se ${NAME_MAX} huroof ka ho.`
          : `Business name must be ${NAME_MIN}–${NAME_MAX} characters.`,
      );
      return false;
    }
    setNameError(undefined);
    return true;
  }

  function handleLanguageChange(next: Language) {
    // Functional, not decorative: the whole form switches immediately and
    // the choice is persisted with the business profile on save.
    setLanguage(next);
    setNameError(undefined);
    setTypeError(undefined);
  }

  function goToStep(next: number) {
    setFormError(null);
    setTypeError(undefined);
    setStep(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    // Enter/submit on earlier steps simply advances the wizard.
    if (step === 0) {
      if (!validateName()) return;
      goToStep(1);
      return;
    }
    if (step === 1) {
      if (!businessType) {
        setTypeError(t.setup.typeRequiredError);
        return;
      }
      goToStep(2);
      return;
    }

    // Safety net — users can only reach the last step with valid data,
    // but never submit stale/invalid values past the boundary checks.
    if (!validateName()) {
      setStep(0);
      return;
    }
    if (!businessType) {
      setTypeError(t.setup.typeRequiredError);
      setStep(1);
      return;
    }

    setPending(true);
    try {
      const result = await completeBusinessSetupAction({
        name: name.trim(),
        businessType,
        currency,
        language,
      });

      if (!result.ok) {
        setFormError(
          mapSetupError(result.reason, t.setup.errors, t.common.errorGeneric),
        );
        setPending(false);
        return;
      }

      setSucceeded(true);
      startTransition(() => {
        router.replace("/dashboard");
      });
    } catch {
      setFormError(t.setup.errors.notConfigured);
      setPending(false);
    }
  }

  // The dashboard is force-dynamic, so a successful client navigation always
  // renders fresh data. If the navigation ever stalls (e.g. a stale router
  // cache entry from the pre-setup redirect), fall back to a full document
  // load so setup always ends on the dashboard.
  useEffect(() => {
    if (!succeeded) return;
    const timer = setTimeout(() => {
      window.location.replace("/dashboard");
    }, REDIRECT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [succeeded]);

  if (succeeded) {
    return (
      <div className="py-6 text-center" role="status">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-accent">
          <CheckCircleIcon className="size-7" />
        </span>
        <h2 className="mt-5 font-display text-display-md font-light">
          {t.setup.successTitle}
        </h2>
        <p className="mt-3 flex items-center justify-center gap-2.5 text-sm text-muted">
          <Spinner />
          {t.setup.successBody}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* Progress */}
      <div className="mb-8 flex items-center justify-between gap-4">
        <p
          className="text-xs font-medium uppercase tracking-widest text-faint"
          aria-live="polite"
        >
          {t.setup.stepOf
            .replace("{current}", String(step + 1))
            .replace("{total}", String(TOTAL_STEPS))}
        </p>
        <div className="flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: TOTAL_STEPS }, (_, index) => (
            <span
              key={index}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                index === step
                  ? "w-6 bg-emerald-400 shadow-glow-btn"
                  : index < step
                    ? "w-3 bg-emerald-500/60"
                    : "w-3 bg-line",
              )}
            />
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -24 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-6"
        >
          {step === 0 ? (
            <>
              <h2 className="font-display text-2xl font-light text-balance sm:text-[1.7rem]">
                {t.setup.stepNameTitle}
              </h2>
              <TextField
                id="setup-name"
                label={t.setup.businessNameLabel}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t.setup.businessNamePlaceholder}
                hint={t.setup.businessNameHint}
                error={nameError}
                maxLength={NAME_MAX}
                autoComplete="organization"
                autoFocus
                required
              />
            </>
          ) : null}

          {step === 1 ? (
            <>
              <h2 className="font-display text-2xl font-light text-balance sm:text-[1.7rem]">
                {t.setup.businessTypeLabel}
              </h2>
              <fieldset>
                <legend className="sr-only">{t.setup.businessTypeLabel}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {BUSINESS_TYPES.map((type) => {
                    const active = businessType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          setBusinessType(type);
                          setTypeError(undefined);
                        }}
                        className={cn(
                          "flex min-h-11 items-center justify-between gap-2 rounded-xl border p-4 text-left shadow-card transition-all duration-200",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                          active
                            ? "border-emerald-500/60 bg-emerald-500/[0.07]"
                            : typeError
                              ? "border-faint bg-surface hover:border-faint"
                              : "border-line bg-surface hover:border-emerald-500/30",
                        )}
                      >
                        <span className="text-sm font-medium">
                          {t.businessTypes[type]}
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                            active
                              ? "border-emerald-500 bg-emerald-500 text-emerald-950"
                              : "border-line",
                          )}
                        >
                          {active ? <CheckCircleIcon className="size-3.5" /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {typeError ? (
                  <p
                    role="alert"
                    className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted"
                  >
                    <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
                    {typeError}
                  </p>
                ) : null}
              </fieldset>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h2 className="font-display text-2xl font-light text-balance sm:text-[1.7rem]">
                {t.setup.stepLanguageTitle}
              </h2>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-foreground">
                  {t.setup.languageLabel}
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      { code: "en", label: t.setup.languageOptionEn, hint: t.setup.languageOptionEnHint },
                      { code: "ur", label: t.setup.languageOptionUr, hint: t.setup.languageOptionUrHint },
                    ] as const
                  ).map((option) => {
                    const active = language === option.code;
                    return (
                      <button
                        key={option.code}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => handleLanguageChange(option.code)}
                        className={cn(
                          "rounded-xl border p-4 text-left shadow-card transition-all duration-200",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                          active
                            ? "border-emerald-500/60 bg-emerald-500/[0.07]"
                            : "border-line bg-surface hover:border-emerald-500/30",
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{option.label}</span>
                          <span
                            aria-hidden
                            className={cn(
                              "flex size-5 items-center justify-center rounded-full border transition-colors",
                              active
                                ? "border-emerald-500 bg-emerald-500 text-emerald-950"
                                : "border-line",
                            )}
                          >
                            {active ? <CheckCircleIcon className="size-3.5" /> : null}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs text-faint">
                          {option.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <SelectField
                id="setup-currency"
                label={t.setup.currencyLabel}
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                hint={t.setup.currencyHint}
                required
              >
                {CURRENCIES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code} — {item.label} ({item.symbol})
                  </option>
                ))}
              </SelectField>
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>

      {formError ? (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          {formError}
        </div>
      ) : null}

      {/* Step controls */}
      <div className="mt-8 flex items-center gap-3">
        {step > 0 ? (
          <Button
            variant="ghost"
            size="lg"
            onClick={() => goToStep(step - 1)}
            disabled={pending}
          >
            {t.common.back}
          </Button>
        ) : null}
        <Button
          type="submit"
          size="lg"
          className={cn("flex-1", step === 0 && "w-full")}
          disabled={pending}
        >
          {pending ? (
            <>
              <Spinner />
              {t.setup.working}
            </>
          ) : step < TOTAL_STEPS - 1 ? (
            <>
              {t.setup.nextButton}
              <ArrowRightIcon className="size-4" />
            </>
          ) : (
            <>
              <StoreIcon className="size-[18px]" />
              {t.setup.finishButton}
            </>
          )}
        </Button>
      </div>

      <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-faint">
        <GlobeIcon className="size-3.5 shrink-0 text-accent/70" />
        {language === "ur"
          ? "Ap ye setting baad mein Settings se badal sakte hain."
          : "You can change these details later in Settings."}
      </p>
    </form>
  );
}

function mapSetupError(
  reason: string | undefined,
  errors: Dictionary["setup"]["errors"],
  fallback: string,
): string {
  switch (reason) {
    case "unauthenticated":
      return errors.unauthenticated;
    case "invalid_input":
      return errors.invalidInput;
    case "database_error":
      return errors.database;
    case "not_configured":
      return errors.notConfigured;
    default:
      return fallback;
  }
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
    />
  );
}
