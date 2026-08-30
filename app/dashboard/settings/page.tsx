import type { Metadata } from "next";
import { SettingsForm } from "@/components/settings/settings-form";
import { MarketingSettings } from "@/components/settings/marketing-settings";
import { getUserBusiness } from "@/lib/business/service";
import {
  getConnectedAccounts,
  getMarketingWallet,
} from "@/lib/marketing/service";
import { getServerUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Settings",
};

export const dynamic = "force-dynamic";

/** Business identity and preferences — saved through the guarded actions. */
export default async function SettingsPage() {
  const [business, user, walletResult, accountsResult] = await Promise.all([
    getUserBusiness(),
    getServerUser(),
    getMarketingWallet(),
    getConnectedAccounts(),
  ]);

  if (!business) {
    // The layout already gates this case; kept as a safe fallback.
    return null;
  }

  return (
    <div className="space-y-6">
      <SettingsForm business={business} userEmail={user?.email ?? null} />
      <MarketingSettings
        business={business}
        initialAccounts={accountsResult.ok ? accountsResult.data : []}
        initialBudgetCap={walletResult.ok ? walletResult.data?.monthlyBudgetCap ?? null : null}
        accountsLoadFailed={!accountsResult.ok}
        walletLoadFailed={!walletResult.ok}
      />
    </div>
  );
}
