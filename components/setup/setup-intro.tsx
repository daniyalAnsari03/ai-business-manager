"use client";

import { useI18n } from "@/components/i18n/language-provider";

/** Localized intro panel beside the Business Setup form. */
export function SetupIntro() {
  const { t } = useI18n();

  return (
    <section className="text-center lg:text-left">
      <span className="eyebrow">{t.setup.introEyebrow}</span>
      <h1 className="mt-5 font-display text-display-lg font-light text-balance">
        {t.setup.introTitlePlain}{" "}
        <span className="text-accent">{t.setup.introTitleAccent}</span>
      </h1>
      <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted lg:mx-0">
        {t.setup.introBody}
      </p>
    </section>
  );
}
