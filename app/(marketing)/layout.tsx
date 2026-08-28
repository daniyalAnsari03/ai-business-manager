import type { ReactNode } from "react";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

/**
 * Public marketing chrome (Phase 1 homepage). Auth and application routes
 * live outside this group so they render without the site header/footer.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
