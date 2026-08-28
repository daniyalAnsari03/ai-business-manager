import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { LanguageProvider } from "@/components/i18n/language-provider";
import { getUserBusiness } from "@/lib/business/service";
import { getUserProfile } from "@/lib/profiles/service";
import { getServerUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Server-side protection for the whole application area:
 * - no session → login
 * - session without completed Business Setup → setup (cannot be bypassed
 *   by direct URLs; middleware is the first layer, this is the second)
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getServerUser();
  if (!user) redirect("/login?next=/dashboard");

  // Independent lookups — run together so navigation waits for one round
  // trip instead of two (the session itself is request-cached).
  const [business, profile] = await Promise.all([
    getUserBusiness(),
    getUserProfile(),
  ]);
  if (!business?.setupCompleted) redirect("/setup");

  return (
    <LanguageProvider initialLanguage={business.language}>
      <AppShell
        businessName={business.name}
        businessType={business.businessType}
        displayName={profile?.displayName ?? null}
        avatarUrl={profile?.avatarUrl ?? null}
        userEmail={user.email ?? null}
      >
        {children}
      </AppShell>
    </LanguageProvider>
  );
}
