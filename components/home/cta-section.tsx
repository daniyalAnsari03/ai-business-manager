import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon } from "@/components/ui/icons";

const START_STEPS = [
  "Create your free account",
  "Tell us about your business — 1 minute",
  "Put your AI Manager to work",
] as const;

export function CtaSection() {
  return (
    <section
      id="get-started"
      aria-label="Get started"
      className="relative scroll-mt-24 pb-24 pt-4 sm:pb-28"
    >
      <div className="container-page">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] border border-emerald-500/20 bg-gradient-to-b from-surface-raised to-surface px-6 py-16 text-center shadow-card sm:px-12 sm:py-20">
            {/* Emerald atmosphere */}
            <div
              aria-hidden
              className="ambient-glow left-1/2 top-0 size-[520px] -translate-x-1/2 -translate-y-1/2"
            />
            <div
              aria-hidden
              className="absolute inset-x-16 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent"
            />

            <div className="relative mx-auto max-w-2xl">
              <span className="eyebrow">Getting started</span>
              <h2 className="mt-6 font-display text-display-lg font-light text-balance">
                Chaliye, apna AI Business Manager{" "}
                <span className="text-accent">shuru karein.</span>
              </h2>
              <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-muted">
                Free to start. No technical setup. Bas apne business ke bare
                mein batayein — kaam shuru ho jayega.
              </p>

              <div className="mt-9 flex flex-wrap items-center justify-center gap-3.5">
                <Button href="/login">
                  Start free
                  <ArrowRightIcon className="size-4" />
                </Button>
                <Button href="#capabilities" variant="secondary">
                  Explore what it can do
                </Button>
              </div>

              <ol className="mt-12 grid gap-3 text-sm text-muted sm:grid-cols-3">
                {START_STEPS.map((step, index) => (
                  <li
                    key={step}
                    className="flex items-center justify-center gap-2.5 rounded-xl border border-line bg-background/60 px-3 py-3.5 backdrop-blur-sm"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-medium text-accent">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
