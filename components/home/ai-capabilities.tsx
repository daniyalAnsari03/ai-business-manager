import { Reveal } from "@/components/motion/reveal";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section";
import {
  ChartIcon,
  MessageCircleIcon,
  TrendingUpIcon,
  ZapIcon,
} from "@/components/ui/icons";

const CAPABILITIES = [
  {
    icon: MessageCircleIcon,
    title: "Ask in your own words",
    text: "No forms, no menus. Just ask like you would ask a trusted employee.",
    example: "\u201CAj ki sales kitni hui?\u201D",
  },
  {
    icon: TrendingUpIcon,
    title: "Insights & reminders",
    text: "It watches your numbers and flags what needs attention before it becomes a problem.",
    example: "\u201CWhite Kurti ka stock khatam ho raha hai.\u201D",
  },
  {
    icon: ZapIcon,
    title: "Actions on request",
    text: "Update stock, add customers, record orders — done in the system, not just discussed.",
    example: "\u201CYe order complete kar do.\u201D",
  },
  {
    icon: ChartIcon,
    title: "Reports on demand",
    text: "Daily sales, weekly expenses, best sellers — clear answers instead of spreadsheets.",
    example: "\u201CIs hafte ka kharcha batao.\u201D",
  },
] as const;

export function AiCapabilitiesSection() {
  return (
    <section
      id="capabilities"
      aria-label="AI capabilities"
      className="relative scroll-mt-24 overflow-clip py-20 sm:py-24 lg:py-28"
    >
      <div
        aria-hidden
        className="ambient-glow left-1/2 top-0 -z-10 size-[420px] -translate-x-1/2 opacity-70"
      />
      <div className="container-page">
        <Reveal>
          <SectionHeading
            eyebrow="What the AI can do"
            title="Ask anything. It answers — and acts."
            description="Built for real shop and business work, not small talk."
          />
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {CAPABILITIES.map((capability, index) => (
            <Reveal key={capability.title} delay={0.06 * index} y={22}>
              <Card className="flex h-full flex-col">
                <span className="flex size-11 items-center justify-center rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/15 to-transparent text-accent">
                  <capability.icon className="size-5" />
                </span>
                <h3 className="mt-5 text-[15px] font-medium">{capability.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">
                  {capability.text}
                </p>
                <p className="mt-4 border-l-2 border-emerald-500/40 pl-3 text-sm italic leading-snug text-faint">
                  {capability.example}
                </p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
