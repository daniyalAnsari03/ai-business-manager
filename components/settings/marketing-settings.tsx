"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { updateMarketingBudgetCapAction } from "@/app/actions/marketing";
import { Spinner } from "@/components/customers/customer-form-modal";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  MegaPhoneIcon,
} from "@/components/ui/icons";
import { TextField } from "@/components/ui/input";
import type { Business } from "@/lib/business/types";
import type { MarketingPlatform } from "@/lib/marketing/types";
import { SETTINGS_PLATFORMS } from "@/lib/marketing/types";
import type { ConnectedAccount } from "@/lib/marketing/types";
import type { Dictionary } from "@/lib/i18n/dictionary";

type MarketingSettingsProps = {
  business: Business;
  initialAccounts: ConnectedAccount[];
  /** null = no cap set yet / wallet row not materialised. */
  initialBudgetCap: number | null;
  accountsLoadFailed?: boolean;
  walletLoadFailed?: boolean;
};

/**
 * Marketing settings shell (Phase 1):
 * - Four channel rows read from connected_accounts; "Not connected" is the
 *   honest default when a platform has no row yet.
 * - The Connect button is deliberately non-functional this phase — it shows a
 *   localized "coming soon" note and never throws.
 * - The monthly ad budget cap is fully functional: a plain number save that
 *   persists to marketing_wallet via the server action (no payment logic).
 */
export function MarketingSettings({
  initialAccounts,
  initialBudgetCap,
  accountsLoadFailed = false,
  walletLoadFailed = false,
}: MarketingSettingsProps) {
  const { t } = useI18n();
  const router = useRouter();

  const accountsByPlatform = new Map(
    initialAccounts.map((account) => [account.platform, account]),
  );

  const [budgetValue, setBudgetValue] = useState(
    initialBudgetCap === null ? "" : String(initialBudgetCap),
  );
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetSaved, setBudgetSaved] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [connectNoteFor, setConnectNoteFor] = useState<MarketingPlatform | null>(null);

  const budgetDisabled = budgetSaving || walletLoadFailed;

  function handleConnectClick(platform: MarketingPlatform) {
    // Phase 1: OAuth joining arrives in a later phase. Show the localized
    // note and no-op — never throw.
    setConnectNoteFor(platform);
  }

  async function handleBudgetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBudgetError(null);
    setBudgetSaved(false);

    const raw = budgetValue.trim();
    if (raw !== "" && !/^\d+(\.\d{1,2})?$/.test(raw)) {
      setBudgetError(t.settings.errors.invalid_input);
      return;
    }

    setBudgetSaving(true);
    try {
      const result = await updateMarketingBudgetCapAction(raw === "" ? null : raw);
      if (!result.ok) {
        setBudgetError(
          result.reason === "no_business"
            ? t.common.errorGeneric
            : t.settings.errors[result.reason as keyof Dictionary["settings"]["errors"]] ??
                t.common.errorGeneric,
        );
        setBudgetSaving(false);
        return;
      }
      setBudgetValue(result.monthlyBudgetCap === null ? "" : String(result.monthlyBudgetCap));
      setBudgetSaved(true);
      setBudgetSaving(false);
      // Server components re-render with the saved wallet values.
      router.refresh();
    } catch {
      setBudgetError(t.settings.errors.database_error);
      setBudgetSaving(false);
    }
  }

  return (
    <Card lift={false} className="relative overflow-hidden !p-6">
      <div aria-hidden className="ambient-glow -right-16 -top-24 size-[260px]" />
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-accent">
            <MegaPhoneIcon className="size-[18px]" />
          </span>
          <div>
            <h2 className="text-sm font-medium uppercase tracking-widest text-faint">
              {t.settings.marketingSection}
            </h2>
            <p className="mt-1 text-sm text-muted">{t.settings.marketingSectionHint}</p>
          </div>
        </div>

        {/* Channels — read real status rows, default honestly to Not connected */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {SETTINGS_PLATFORMS.map((platform) => {
            const account = accountsByPlatform.get(platform);
            const connected = account?.status === "connected";
            return (
              <div
                key={platform}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {platformLabel(t, platform)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {connected
                      ? account?.accountLabel ?? t.settings.statusConnected
                      : t.settings.statusNotConnected}
                  </p>
                </div>
                <Button
                  size="md"
                  variant={connected ? "secondary" : "primary"}
                  disabled={connected}
                  onClick={() => handleConnectClick(platform)}
                  aria-label={`${t.settings.connectButton} — ${platformLabel(t, platform)}`}
                >
                  {connected ? t.settings.statusConnected : t.settings.connectButton}
                </Button>
              </div>
            );
          })}
        </div>

        {/* Connect button behaviour note */}
        {connectNoteFor ? (
          <p
            role="status"
            className="mt-3 flex items-center gap-1.5 text-xs leading-relaxed text-faint"
          >
            <AlertCircleIcon className="size-3.5 shrink-0" />
            {platformLabel(t, connectNoteFor)}: {t.settings.connectSoonNote}
          </p>
        ) : null}

        {accountsLoadFailed ? (
          <p
            role="alert"
            className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted"
          >
            <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
            {t.settings.connectLoadError}
          </p>
        ) : null}

        {/* Monthly ad budget cap — functional save */}
        <form onSubmit={handleBudgetSubmit} noValidate className="mt-6 max-w-xl">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <TextField
                id="marketing-monthly-budget-cap"
                label={t.settings.monthlyBudgetLabel}
                value={budgetValue}
                onChange={(event) => {
                  setBudgetValue(event.target.value);
                  setBudgetSaved(false);
                  setBudgetError(null);
                }}
                placeholder={t.settings.budgetPlaceholder}
                hint={t.settings.monthlyBudgetHint}
                inputMode="decimal"
                autoComplete="off"
                maxLength={14}
                disabled={budgetDisabled}
              />
            </div>
            <div className="flex min-h-12 items-center gap-3 pb-px">
              <Button type="submit" size="lg" disabled={budgetDisabled}>
                {budgetSaving ? (
                  <>
                    <Spinner />
                    {t.settings.savingBudgetButton}
                  </>
                ) : (
                  t.settings.saveBudgetButton
                )}
              </Button>
            </div>
          </div>

          {budgetError ? (
            <p
              role="alert"
              className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted"
            >
              <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
              {budgetError}
            </p>
          ) : null}

          {budgetSaved ? (
            <p
              role="status"
              className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
            >
              <CheckCircleIcon className="size-3.5 shrink-0" />
              {t.settings.budgetSavedToast}
            </p>
          ) : null}
        </form>
      </div>
    </Card>
  );
}

function platformLabel(t: Dictionary, platform: MarketingPlatform): string {
  switch (platform) {
    case "instagram":
      return t.settings.platformInstagram;
    case "facebook":
      return t.settings.platformFacebook;
    case "google_ads":
      return t.settings.platformGoogleAds;
    case "whatsapp":
      return t.settings.platformWhatsapp;
  }
}