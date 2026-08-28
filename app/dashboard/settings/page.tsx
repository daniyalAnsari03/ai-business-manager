import type { Metadata } from "next";
import { SettingsForm } from "@/components/settings/settings-form";
import { getUserBusiness } from "@/lib/business/service";
import { getServerUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Settings",
};

export const dynamic = "force-dynamic";

/** Business identity and preferences — saved through the guarded action. */
export default async function SettingsPage() {
  const [business, user] = await Promise.all([
    getUserBusiness(),
    getServerUser(),
  ]);

  if (!business) {
    // The layout already gates this case; kept as a safe fallback.
    return null;
  }

  return <SettingsForm business={business} userEmail={user?.email ?? null} />;
}
