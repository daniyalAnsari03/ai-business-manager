"use client";

import { useI18n } from "@/components/i18n/language-provider";

/** Small localized hint in the setup screen's top bar. */
export function SetupStepBadge() {
  const { t } = useI18n();

  return (
    <span className="hidden items-center gap-2 text-xs text-faint sm:flex">
      <span className="size-1.5 rounded-full bg-emerald-400" />
      {t.setup.introEyebrow}
    </span>
  );
}
