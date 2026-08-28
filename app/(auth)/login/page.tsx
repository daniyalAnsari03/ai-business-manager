import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { LanguageProvider } from "@/components/i18n/language-provider";
import { LanguageToggle } from "@/components/i18n/language-toggle";
import { BrandMark, BrandWordmark } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to your AI Business Manager — Google ya email se. Apka AI manager kaam ke liye tayyar hai.",
};

/**
 * Premium, minimal authentication screen: Google first, email second.
 * Language switching is functional from this very first screen.
 */
export default function LoginPage() {
  return (
    <LanguageProvider initialLanguage="en">
      <div className="relative flex min-h-svh flex-col overflow-hidden">
        {/* Emerald atmosphere */}
        <div
          aria-hidden
          className="ambient-glow -top-40 left-1/2 size-[640px] -translate-x-1/2"
        />
        <div
          aria-hidden
          className="ambient-glow bottom-[-18rem] right-[-12rem] size-[560px]"
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
            <LanguageToggle />
          </div>
        </header>

        <main
          id="main"
          className="relative z-10 flex flex-1 items-center justify-center px-5 py-10 sm:px-8"
        >
          <div className="w-full max-w-md">
            <div className="card-surface relative overflow-hidden px-6 py-9 sm:px-9 sm:py-11">
              <div
                aria-hidden
                className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent"
              />
              <Suspense fallback={<LoginFormSkeleton />}>
                <LoginForm />
              </Suspense>
            </div>
          </div>
        </main>
      </div>
    </LanguageProvider>
  );
}

function LoginFormSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden>
      <div className="h-8 w-3/4 rounded-lg bg-surface-raised" />
      <div className="h-4 w-full rounded bg-surface-raised" />
      <div className="h-12 w-full rounded-xl bg-surface-raised" />
      <div className="h-12 w-full rounded-xl bg-surface-raised" />
      <div className="h-12 w-full rounded-xl bg-surface-raised" />
    </div>
  );
}
