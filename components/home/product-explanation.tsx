import { Reveal } from "@/components/motion/reveal";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section";
import {
  ArrowRightIcon,
  CheckIcon,
  MessageCircleIcon,
} from "@/components/ui/icons";

const CHATBOT_POINTS = [
  "Talks back, but changes nothing",
  "Guesses answers without seeing your business",
  "Forgets everything after the chat ends",
] as const;

const MANAGER_POINTS = [
  "Sees your real sales, stock and customers",
  "Does approved work for you — updates, entries, reports",
  "Verifies every result before reporting back",
] as const;

const STEPS = [
  {
    title: "You ask",
    text: "\u201CAj ki sales kitni hui?\u201D — plain words are enough.",
  },
  {
    title: "It checks your data",
    text: "Looks at your real numbers, not guesses.",
  },
  {
    title: "It acts with approval",
    text: "For important changes it shows you first and waits for your OK.",
  },
  {
    title: "You get proof",
    text: "The result is verified, then reported honestly.",
  },
] as const;

export function ProductExplanationSection() {
  return (
    <section
      id="how-it-works"
      aria-label="How it works"
      className="relative scroll-mt-24 py-20 sm:py-24 lg:py-28"
    >
      <div className="container-page">
        <Reveal>
          <SectionHeading
            eyebrow="More than a chatbot"
            title={
              <>
                Not a chatbot. A manager that{" "}
                <span className="text-accent">works.</span>
              </>
            }
            description="Chatbots only reply. The AI Business Manager understands your request, looks at your actual business data, performs approved actions and verifies the outcome."
          />
        </Reveal>

        <div className="mt-14 grid gap-6 lg:grid-cols-[1fr_auto_1.15fr] lg:items-stretch">
          <Reveal delay={0.05}>
            <Card className="h-full opacity-90">
              <p className="text-sm font-medium uppercase tracking-wider text-faint">
                Ordinary chatbots
              </p>
              <ul className="mt-5 space-y-4">
                {CHATBOT_POINTS.map((point) => (
                  <li key={point} className="flex gap-3 text-muted">
                    <span
                      aria-hidden
                      className="mt-[7px] size-1.5 shrink-0 rounded-full bg-faint/70"
                    />
                    <span className="leading-relaxed">{point}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </Reveal>

          <div className="hidden items-center justify-center lg:flex">
            <span className="flex size-11 items-center justify-center rounded-full border border-line bg-background shadow-card">
              <ArrowRightIcon className="size-5 text-accent" />
            </span>
          </div>

          <Reveal delay={0.12}>
            <Card
              className="h-full border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.07] to-transparent"
              lift={false}
            >
              <p className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-accent">
                <MessageCircleIcon className="size-4" />
                AI Business Manager
              </p>
              <ul className="mt-5 space-y-4">
                {MANAGER_POINTS.map((point) => (
                  <li key={point} className="flex gap-3">
                    <CheckIcon className="mt-1 size-4 shrink-0 text-accent" />
                    <span className="leading-relaxed text-foreground">
                      {point}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </Reveal>
        </div>

        {/* Ask → Act → Verify pipeline */}
        <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Reveal delay={0.06 * index} y={20}>
                <Card className="h-full" >
                  <span className="font-display text-3xl font-light text-accent">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-3 text-[15px] font-medium">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">
                    {step.text}
                  </p>
                </Card>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
