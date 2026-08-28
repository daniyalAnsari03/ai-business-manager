import { Reveal } from "@/components/motion/reveal";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section";
import { GlobeIcon } from "@/components/ui/icons";

export function LanguageSupportSection() {
  return (
    <section
      id="languages"
      aria-label="English and Roman Urdu support"
      className="relative scroll-mt-24 py-20 sm:py-24 lg:py-28"
    >
      <div className="container-page">
        <Reveal>
          <SectionHeading
            eyebrow="Aap ki zubaan"
            title={
              <>
                English ya Roman Urdu — <span className="text-accent">aap ki marzi.</span>
              </>
            }
            description="Switch anytime. Buttons, forms, answers, even explanations of what the AI did — everything follows your language."
          />
        </Reveal>

        <div className="mx-auto mt-14 grid max-w-4xl gap-5 md:grid-cols-2">
          <Reveal delay={0.05}>
            <Card className="h-full" lift={false}>
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-faint">
                <GlobeIcon className="size-4" />
                English
              </p>
              <p className="mt-5 w-fit rounded-2xl rounded-br-sm bg-surface-raised px-4 py-2.5 text-sm shadow-card">
                How were today&rsquo;s sales?
              </p>
              <p className="mt-3 w-fit rounded-2xl rounded-bl-sm bg-emerald-500/15 px-4 py-2.5 text-sm text-accent-strong dark:text-emerald-200">
                Today&rsquo;s total sale is Rs. 25,000 — up 12% from yesterday.
              </p>
            </Card>
          </Reveal>

          <Reveal delay={0.12}>
            <Card className="h-full" lift={false}>
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-faint">
                <GlobeIcon className="size-4" />
                Roman Urdu
              </p>
              <p className="mt-5 w-fit rounded-2xl rounded-br-sm bg-surface-raised px-4 py-2.5 text-sm shadow-card">
                Aj ki sales kitni hui?
              </p>
              <p className="mt-3 w-fit rounded-2xl rounded-bl-sm bg-emerald-500/15 px-4 py-2.5 text-sm text-accent-strong dark:text-emerald-200">
                Apki aaj ki total sale Rs. 25,000 hai.
              </p>
            </Card>
          </Reveal>
        </div>

        <Reveal delay={0.18}>
          <p className="mt-8 text-center text-sm text-faint">
            Your product names stay exactly as you wrote them — nothing is
            translated behind your back.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
