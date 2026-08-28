import { Reveal } from "@/components/motion/reveal";
import { SectionHeading } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { MicIcon } from "@/components/ui/icons";

const FLOW = [
  { step: "1", label: "Aap bolein", en: "You speak" },
  { step: "2", label: "Samajhta hai", en: "It understands" },
  { step: "3", label: "Kaam karta hai", en: "It acts" },
  { step: "4", label: "Jawab deta hai", en: "It answers" },
] as const;

export function VoiceCapabilitySection() {
  return (
    <section
      id="voice"
      aria-label="Voice capability"
      className="relative scroll-mt-24 overflow-clip py-20 sm:py-24 lg:py-28"
    >
      <div
        aria-hidden
        className="ambient-glow right-0 top-16 -z-10 size-[380px] opacity-70"
      />
      <div className="container-page grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <Reveal>
          <SectionHeading
            align="left"
            eyebrow="Hands busy? Just speak"
            title={
              <>
                Bol kar bhi <span className="text-accent">chalao.</span>
              </>
            }
            description="Counter par kaam karte waqt type karna mushkil hota hai. Mic dabayein, apni baat kahein — AI Business Manager samjhega, kaam karega aur jawab dega. Works in English and Roman Urdu."
          />
        </Reveal>

        <Reveal delay={0.1}>
          <Card lift={false} className="relative overflow-hidden text-center">
            <div
              aria-hidden
              className="ambient-glow left-1/2 top-6 size-56 -translate-x-1/2"
            />
            {/* Microphone control */}
            <div className="relative mx-auto mt-4 flex size-24 items-center justify-center">
              <span
                aria-hidden
                className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20 [animation-duration:2.6s]"
              />
              <span
                aria-hidden
                className="absolute inset-2 rounded-full bg-emerald-500/10"
              />
              <span className="relative flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-700 text-emerald-950 shadow-glow-btn">
                <MicIcon className="size-7" />
              </span>
            </div>
            <p className="mt-5 text-sm font-medium">
              &ldquo;Aaj ki sale batao&rdquo;
            </p>
            <p className="mt-1 text-xs text-faint">
              Browser-based voice · No extra cost · Permission aap ke haath mein
            </p>

            <ol className="mt-8 grid grid-cols-2 gap-2 pb-2 sm:grid-cols-4">
              {FLOW.map((item) => (
                <li
                  key={item.step}
                  className="rounded-xl border border-line px-2 py-3"
                >
                  <span className="text-xs font-medium text-accent">
                    {item.step}
                  </span>
                  <p className="mt-0.5 text-xs font-medium">{item.label}</p>
                  <p className="text-[11px] text-faint">{item.en}</p>
                </li>
              ))}
            </ol>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}
