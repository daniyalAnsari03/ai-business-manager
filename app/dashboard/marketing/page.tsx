import type { Metadata } from "next";
import { MarketingView } from "@/components/marketing/marketing-view";
import { getUserBusiness } from "@/lib/business/service";
import { getMarketingMetrics } from "@/lib/marketing/service";
import { listSocialPosts } from "@/lib/marketing/social-posts";

export const metadata: Metadata = {
  title: "Marketing",
};

export const dynamic = "force-dynamic";

/**
 * Marketing module — shows real activity: metric cards read from the
 * marketing tables, and the Activity feed lists REAL AI-generated draft
 * posts from social_posts (product name + caption preview + Publish button).
 */
export default async function MarketingPage() {
  const business = await getUserBusiness();

  if (!business) {
    // The layout already gates this case; kept as a safe fallback.
    return null;
  }

  const [metricsResult, postsResult] = await Promise.all([
    getMarketingMetrics(),
    listSocialPosts(),
  ]);

  return (
    <MarketingView
      business={business}
      metrics={metricsResult.ok ? metricsResult.data : null}
      initialPosts={postsResult.ok ? postsResult.data : []}
      postsLoadFailed={!postsResult.ok}
      loadFailed={!metricsResult.ok}
    />
  );
}