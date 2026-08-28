"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/actions/auth";
import { updateLanguagePreferenceAction } from "@/app/actions/profile";
import { useI18n } from "@/components/i18n/language-provider";
import {
  CheckIcon,
  ChevronDownIcon,
  LogOutIcon,
} from "@/components/ui/icons";
import type { BusinessType } from "@/lib/business/constants";
import type { Language } from "@/lib/business/types";
import { cn } from "@/lib/utils";

const LANGUAGE_OPTIONS: Language[] = ["en", "ur"];

function initialsFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "A";
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    return (
      <Image
        src={url}
        alt=""
        width={40}
        height={40}
        unoptimized
        className="size-10 shrink-0 rounded-full border border-line object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-medium text-accent"
    >
      {initialsFor(name)}
    </span>
  );
}

/**
 * Account popover for the authenticated business owner: profile identity,
 * owned-business summary, language preference and real Supabase logout.
 * Rendered inside the app shell footer on desktop sidebar and mobile drawer.
 */
export function UserMenu({
  businessName,
  businessType,
  displayName,
  avatarUrl,
  email,
}: {
  businessName: string;
  businessType: BusinessType;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}) {
  const { t, language, setLanguage } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [savingLang, setSavingLang] = useState<Language | null>(null);
  const [langError, setLangError] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleLanguageChange(next: Language) {
    if (next === language || savingLang) return;
    const previous = language;
    setSavingLang(next);
    setLangError(false);
    setLanguage(next);
    try {
      const result = await updateLanguagePreferenceAction(next);
      if (!result.ok) {
        setLanguage(previous);
        setLangError(true);
      }
    } catch {
      setLanguage(previous);
      setLangError(true);
    } finally {
      setSavingLang(null);
    }
  }

  const avatarName = displayName ?? businessName;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="user-menu-panel"
        aria-label={
          open ? t.userMenu.closeAccountMenu : t.userMenu.openAccountMenu
        }
        className="flex min-h-11 w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-surface-raised"
      >
        <Avatar name={avatarName} url={avatarUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {businessName}
          </span>
          {email ? (
            <span className="block truncate text-xs text-faint">{email}</span>
          ) : null}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-faint transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          id="user-menu-panel"
          role="group"
          aria-label={t.userMenu.accountSection}
          className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-2xl border border-line bg-surface-raised/95 p-3 shadow-phone backdrop-blur-xl"
        >
          <div className="flex items-center gap-3 px-1 py-1.5">
            <Avatar name={avatarName} url={avatarUrl} />
            <div className="min-w-0 flex-1">
              {displayName ? (
                <p className="truncate text-sm font-medium">{displayName}</p>
              ) : null}
              {email ? (
                <p
                  className={cn(
                    "truncate text-xs text-muted",
                    !displayName && "text-sm font-medium",
                  )}
                >
                  {email}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-2 rounded-xl border border-line bg-surface px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-widest text-faint">
              {t.userMenu.businessSection}
            </p>
            <p className="truncate text-sm font-medium">{businessName}</p>
            <p className="truncate text-xs text-muted">
              {t.businessTypes[businessType]}
            </p>
          </div>

          <div className="mt-3">
            <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-widest text-faint">
              {t.userMenu.languageLabel}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleLanguageChange(option)}
                  disabled={savingLang !== null}
                  aria-pressed={language === option}
                  className={cn(
                    "flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                    language === option
                      ? "border-emerald-500/40 bg-emerald-500/[0.12] text-accent"
                      : "border-line text-muted hover:border-emerald-500/30 hover:text-foreground",
                  )}
                >
                  {language === option ? (
                    <CheckIcon className="size-3.5 shrink-0" />
                  ) : null}
                  {option === "en"
                    ? t.setup.languageOptionEn
                    : t.setup.languageOptionUr}
                </button>
              ))}
            </div>
            {langError ? (
              <p role="alert" className="px-1 pt-1.5 text-xs text-muted">
                {t.userMenu.languageError}
              </p>
            ) : null}
          </div>

          <form action={signOutAction} className="mt-3 border-t border-line pt-3">
            <button
              type="submit"
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-muted transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
            >
              <LogOutIcon className="size-[18px] shrink-0" />
              {t.common.logOut}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
