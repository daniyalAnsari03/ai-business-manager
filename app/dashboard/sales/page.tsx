import type { Metadata } from "next";
import { SalesView } from "@/components/sales/sales-view";
import { getUserBusiness } from "@/lib/business/service";
import { getRecentSales, getSalesSummary } from "@/lib/sales/service";

export const metadata: Metadata = {
  title: "Sales",
};

export const dynamic = "force-dynamic";

/** Real revenue summary + latest completed sales for this business only. */
export default async function SalesPage() {
  const business = await getUserBusiness();

  if (!business) {
    // The layout already gates this case; kept as a safe fallback.
    return null;
  }

  const [summaryResult, recentResult] = await Promise.all([
    getSalesSummary(),
    getRecentSales(10),
  ]);

  return (
    <SalesView
      currency={business.currency}
      summary={summaryResult.ok ? summaryResult.data : null}
      recentSales={recentResult.ok ? recentResult.data : []}
      loadFailed={!summaryResult.ok || !recentResult.ok}
    />
  );
}
