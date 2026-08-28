import { Reveal } from "@/components/motion/reveal";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section";
import {
  ArchiveIcon,
  CartIcon,
  ChartIcon,
  GaugeIcon,
  SettingsIcon,
  UsersIcon,
  WalletIcon,
  ZapIcon,
} from "@/components/ui/icons";

const MODULES = [
  {
    icon: GaugeIcon,
    name: "Dashboard",
    text: "Aaj ka sab kuch — ek nazar mein.",
  },
  {
    icon: ArchiveIcon,
    name: "Products & Stock",
    text: "Har item ka poora hisaab.",
  },
  {
    icon: CartIcon,
    name: "Orders",
    text: "Naye aur purane orders, sab track.",
  },
  {
    icon: UsersIcon,
    name: "Customers",
    text: "Apne customers ka record saaf.",
  },
  {
    icon: ZapIcon,
    name: "Sales",
    text: "Roz ki sale, bina confusion.",
  },
  {
    icon: WalletIcon,
    name: "Expenses",
    text: "Kharcha likha jaye to nazar aaye.",
  },
  {
    icon: ChartIcon,
    name: "Reports & Insights",
    text: "Business ki asli picture.",
  },
  {
    icon: SettingsIcon,
    name: "Settings",
    text: "Business apne mutabiq set karein.",
  },
] as const;

export function BusinessModulesSection() {
  return (
    <section
      id="modules"
      aria-label="Business management modules"
      className="relative scroll-mt-24 py-20 sm:py-24 lg:py-28"
    >
      <div className="container-page">
        <Reveal>
          <SectionHeading
            eyebrow="One place for everything"
            title="Manage your whole business in one place"
            description="Sales, stock, customers, expenses — sab kuch ek hi jagah. The AI Manager works across all of it."
          />
        </Reveal>

        <ul className="mt-14 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {MODULES.map((module, index) => (
            <li key={module.name} className="h-full">
              <Reveal delay={0.04 * (index % 4)} y={18} className="h-full">
                <Card className="flex h-full flex-col p-5 sm:p-6">
                  <module.icon className="size-[22px] text-accent" />
                  <h3 className="mt-4 text-sm font-medium sm:text-[15px]">
                    {module.name}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted sm:text-sm">
                    {module.text}
                  </p>
                </Card>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
