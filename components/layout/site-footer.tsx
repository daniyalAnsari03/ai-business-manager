import Link from "next/link";
import { BrandMark, BrandWordmark } from "@/components/ui/icons";

const FOOTER_LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "AI capabilities", href: "#capabilities" },
  { label: "Manage everything", href: "#modules" },
  { label: "Safe actions", href: "#actions" },
  { label: "Languages", href: "#languages" },
  { label: "Voice", href: "#voice" },
  { label: "Security", href: "#security" },
] as const;

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line">
      <div className="container-page flex flex-col gap-10 py-14">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <BrandMark className="size-9 rounded-xl shadow-glow-btn" />
              <BrandWordmark className="text-base" />
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Aap ka business manager jo sirf baat nahi karta — kaam bhi karta
              hai. Built for shopkeepers, traders and growing businesses.
            </p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-1">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg py-2 text-sm text-muted transition-colors hover:text-accent"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="hairline" />

        <p className="text-xs text-faint">
          © {year} AI Business Manager. English aur Roman Urdu — dono mein
          available.
        </p>
      </div>
    </footer>
  );
}
