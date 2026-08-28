import type { Metadata } from "next";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { getUserBusiness } from "@/lib/business/service";
import { getDashboardMetrics } from "@/lib/dashboard/service";

export const metadata: Metadata = {
  title: "Dashboard",
};

export const dynamic = "force-dynamic";

/**
 * Dashboard entry — one honest snapshot composed by the dashboard service
 * from every module. When a source fails, its section shows the truthful
 * "not available" state instead of a guess.
 */
export default async function DashboardPage() {
  const business = await getUserBusiness();

  if (!business) {
    // The layout already gates this case; kept as a safe fallback.
    return null;
  }

  const metrics = await getDashboardMetrics();

  return <DashboardOverview business={business} metrics={metrics} />;
}
