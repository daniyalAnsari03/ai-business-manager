"use client";

import { useI18n } from "@/components/i18n/language-provider";
import { cn } from "@/lib/utils";

type LanguageToggleProps = {
  className?: string;
};

/** Compact EN / Roman Urdu switch used on auth and onboarding screens. */
export function LanguageToggle({ className }: LanguageToggleProps) {
  const { language, setLanguage } = useI18n();

  return (
    <div
      role="group"
      aria-label="Language / Zaban"
      className={cn(
        "inline-flex items-center rounded-full border border-line bg-surface p-1 shadow-card",
        className,
      )}
    >
      {(["en", "ur"] as const).map((code) => {
        const active = language === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLanguage(code)}
            aria-pressed={active}
            className={cn(
              "min-h-9 rounded-full px-3.5 text-xs font-medium tracking-wide transition-colors duration-200",
              active
                ? "bg-emerald-500/15 text-accent"
                : "text-muted hover:text-foreground",
            )}
          >
            {code === "en" ? "English" : "Roman Urdu"}
          </button>
        );
      })}
    </div>
  );
}
