import { Reveal } from "@/components/motion/reveal";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section";
import {
  CheckCircleIcon,
  LockIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "@/components/ui/icons";

const PRINCIPLES = [
  {
    icon: ShieldCheckIcon,
    title: "Your data stays yours",
    text: "Your business records are visible only to you. Koi dobara nahi dekh sakta.",
  },
  {
    icon: CheckCircleIcon,
    title: "Approval first",
    text: "Important changes — bade updates, deletions — happen only after you say yes.",
  },
  {
    icon: RefreshCwIcon,
    title: "Verified, honest results",
    text: "The AI checks the outcome before telling you it’s done. No fake success.",
  },
  {
    icon: LockIcon,
    title: "Secure sign-in",
    text: "Sign in with Google or email. Your account is protected with proven security.",
  },
] as const;

export function SecurityControlSection() {
  return (
    <section
      id="security"
      aria-label="Security and control"
      className="relative scroll-mt-24 py-20 sm:py-24 lg:py-28"
    >
      <div className="container-page">
        <Reveal>
          <SectionHeading
            eyebrow="Security & control"
            title={
              <>
                Powerful for you.{" "}
                <span className="text-accent">Under your control.</span>
              </>
            }
            description="AI se kaam karane ka matlab control dena nahi. Har action transparent hai, aur aap hamesha boss."
          />
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {PRINCIPLES.map((principle, index) => (
            <Reveal key={principle.title} delay={0.06 * index} y={22}>
              <Card className="h-full">
                <principle.icon className="size-[22px] text-accent" />
                <h3 className="mt-5 text-[15px] font-medium">{principle.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {principle.text}
                </p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
