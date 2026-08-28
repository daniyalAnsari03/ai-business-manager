import { HeroBackground } from "@/components/home/hero-background";
import { PhonePreview } from "@/components/home/phone-preview";
import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/icons";

const TRUST_POINTS = [
  "Free to start",
  "English & Roman Urdu",
  "Works on your phone",
] as const;

export function HeroSection() {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* Full backdrop (docs/css.txt): near-black base, spotlight glow +
          radar rings behind the phone, grain, stars, vignette. The phone's
          own compact halo/backlight stay inside PhonePreview. */}
      <HeroBackground />

      <div className="container-page relative z-10 grid items-center gap-14 py-14 sm:py-20 lg:min-h-[calc(100svh-4.5rem)] lg:max-h-[calc(100svh-4.5rem)] lg:grid-cols-[1.05fr_0.95fr] lg:gap-6 lg:py-10 xl:gap-10">
        {/* Left — message */}
        <div className="max-w-xl">
          <Reveal>
            <span className="eyebrow">AI-Powered Business Manager</span>
          </Reveal>

          <Reveal delay={0.08}>
            <h1 className="mt-6 font-display text-hero font-light text-balance">
              Your business manager that{" "}
              <em className="text-accent">actually</em> does
              the work
            </h1>
          </Reveal>

          <Reveal delay={0.16}>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
              Ask in plain words. It checks your real numbers, updates stock,
              records orders and prepares reports — with your approval, every
              time.{" "}
              <span className="text-foreground">
                Sirf baatein nahi — kaam bhi.
              </span>
            </p>
          </Reveal>

          <Reveal delay={0.24}>
            <div className="mt-9 flex flex-wrap items-center gap-3.5">
              <Button href="/login">
                Get started free
                <ArrowRightIcon className="size-4" />
              </Button>
              <Button href="#how-it-works" variant="secondary">
                See how it works
              </Button>
            </div>
          </Reveal>

          <Reveal delay={0.32}>
            <ul className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-faint">
              {TRUST_POINTS.map((point) => (
                <li key={point} className="flex items-center gap-1.5">
                  <CheckIcon className="size-4 text-accent" />
                  {point}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        {/* Right — floating app preview */}
        <Reveal delay={0.15} y={36} className="lg:justify-self-end">
          <PhonePreview />
        </Reveal>
      </div>
    </section>
  );
}
