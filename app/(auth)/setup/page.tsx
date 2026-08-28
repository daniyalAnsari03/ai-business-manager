import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LanguageProvider } from "@/components/i18n/language-provider";
import { BusinessSetupForm } from "@/components/setup/business-setup-form";
import { SetupIntro } from "@/components/setup/setup-intro";
import { SetupStepBadge } from "@/components/setup/setup-step-badge";
import { BrandMark, BrandWordmark } from "@/components/ui/icons";
import { getUserBusiness } from "@/lib/business/service";
import { getServerUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Business setup",
  description:
    "Aik dafa ka setup — apne business ke bare mein batayein aur AI Manager ko kaam par lagayein.",
};

export const dynamic = "force-dynamic";

/**
 * First-time Business Setup. Server-side gate: unauthenticated users go to
 * login; users who already completed setup go straight to the dashboard.
 */
export default async function SetupPage() {
  const user = await getServerUser();
  if (!user) redirect("/login?next=/setup");

  const business = await getUserBusiness();
  if (business?.setupCompleted) redirect("/dashboard");

  return (
    <LanguageProvider initialLanguage={business?.language ?? "en"}>
      <div className="relative flex min-h-svh flex-col overflow-hidden">
        <div
          aria-hidden
          className="ambient-glow -top-40 left-1/2 size-[640px] -translate-x-1/2"
        />
        <div
          aria-hidden
          className="ambient-glow bottom-[-18rem] left-[-12rem] size-[560px]"
        />

        <header className="relative z-10">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
            <Link
              href="/"
              className="flex min-h-11 items-center gap-2.5"
              aria-label="AI Business Manager — home"
            >
              <BrandMark className="size-9 rounded-xl shadow-glow-btn" />
              <BrandWordmark className="text-base" />
            </Link>
            <SetupStepBadge />
          </div>
        </header>

        <main
          id="main"
          className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 py-10 sm:px-8"
        >
          <div className="mx-auto grid w-full max-w-4xl items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
            <SetupIntro />

            <section className="card-surface relative overflow-hidden px-6 py-8 sm:px-8 sm:py-9">
              <div
                aria-hidden
                className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent"
              />
              <BusinessSetupForm />
            </section>
          </div>
        </main>
      </div>
    </LanguageProvider>
  );
}
