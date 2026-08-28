import { Reveal } from "@/components/motion/reveal";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section";

const ACTION_STEPS = [
  {
    title: "It understands you",
    text: "Pehle wo samajhta hai ke aap ne exactly kya kaha.",
  },
  {
    title: "It finds the item",
    text: "Aap ke products mein Black Kurta dhoondta hai — guess nahi karta.",
  },
  {
    title: "It asks for your OK",
    text: "Change dikhata hai aur aap ki ijazat ka wait karta hai.",
  },
  {
    title: "It does the work",
    text: "Stock ko 50 pcs par update karta hai.",
  },
  {
    title: "It verifies & reports",
    text: "Result check kar ke confirm karta hai — honestly.",
  },
] as const;

export function AgenticActionsSection() {
  return (
    <section
      id="actions"
      aria-label="Agentic actions explained"
      className="relative scroll-mt-24 py-20 sm:py-24 lg:py-28"
    >
      <div className="container-page grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div className="lg:sticky lg:top-28">
          <Reveal>
            <SectionHeading
              align="left"
              eyebrow="Real actions, safely"
              title={
                <>
                  Ek request. Poora{" "}
                  <span className="text-accent">kaam sar-anjaam.</span>
                </>
              }
              description="Ye hai AI Business Manager ka asli tareeqa — sirf jawab dena nahi, kaam karna."
            />
          </Reveal>

          <Reveal delay={0.1}>
            <Card lift={false} className="mt-8 border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.08] to-transparent">
              <p className="text-xs font-medium uppercase tracking-wider text-faint">
                Aap kahein
              </p>
              <p className="mt-3 font-display text-2xl font-light leading-snug text-balance sm:text-[1.7rem]">
                &ldquo;Black Kurta ka stock{" "}
                <span className="text-accent">50</span> kar do.&rdquo;
              </p>
            </Card>
          </Reveal>
        </div>

        {/* Step-by-step walkthrough */}
        <ol className="relative space-y-4 border-l border-line pl-6 sm:pl-8">
          {ACTION_STEPS.map((step, index) => (
            <li key={step.title} className="relative">
              <Reveal delay={0.05 * index} y={18}>
                <span
                  aria-hidden
                  className="absolute -left-[calc(1.5rem+13px)] top-5 flex size-[26px] items-center justify-center rounded-full border border-emerald-500/40 bg-background text-[11px] font-medium text-accent shadow-card sm:-left-[calc(2rem+13px)]"
                >
                  {index + 1}
                </span>
                <Card className="ml-2 p-5 sm:p-6">
                  <h3 className="text-[15px] font-medium">{step.title}</h3>
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
