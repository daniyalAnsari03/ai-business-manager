import type { Metadata } from "next";
import { MarketingView } from "@/components/marketing/marketing-view";
import { getUserBusiness } from "@/lib/business/service";
import {
  getMarketingMetrics,
  getMarketingWallet,
} from "@/lib/marketing/service";
import { getWalletTransactions } from "@/lib/marketing/wallet-service";
import { getPaymentProvider } from "@/lib/marketing/payment-provider";
import { listSocialPosts } from "@/lib/marketing/social-posts";
import { getAutomationMode } from "@/lib/marketing/automation";

export const metadata: Metadata = {
  title: "Marketing",
};

export const dynamic = "force-dynamic";

/**
 * Marketing module — shows real activity: metric cards read from the
 * marketing tables, the Activity feed lists REAL AI-generated draft posts,
 * and the wallet dashboard shows real balance + transaction ledger entries.
 */
export default async function MarketingPage() {
  const business = await getUserBusiness();

  if (!business) {
    // The layout already gates this case; kept as a safe fallback.
    return null;
  }

  const [
    metricsResult,
    postsResult,
    walletResult,
    walletTxResult,
    automationResult,
  ] = await Promise.all([
    getMarketingMetrics(),
    listSocialPosts(),
    getMarketingWallet(),
    getWalletTransactions(50),
    getAutomationMode(),
  ]);

  // Whether a real payment provider is configured. When none, the top-up UI
  // honestly disables itself (no fake payments in Phase 0/3).
  const paymentProviderAvailable = getPaymentProvider() !== null;

  const initialBalance = walletResult.ok && walletResult.data
    ? walletResult.data.balance
    : 0;
  const monthlyBudgetCap =
    walletResult.ok && walletResult.data
      ? walletResult.data.monthlyBudgetCap
      : null;

  return (
    <MarketingView
      business={business}
      metrics={metricsResult.ok ? metricsResult.data : null}
      initialPosts={postsResult.ok ? postsResult.data : []}
      postsLoadFailed={!postsResult.ok}
      loadFailed={!metricsResult.ok}
      initialWalletBalance={initialBalance}
      initialWalletMonthlyBudgetCap={monthlyBudgetCap}
      initialWalletTransactions={
        walletTxResult.ok ? walletTxResult.data : []
      }
      walletLoadFailed={!walletResult.ok || !walletTxResult.ok}
      paymentProviderAvailable={paymentProviderAvailable}
      showTestSpend={process.env.NODE_ENV !== "production"}
      initialAutomationMode={automationResult.ok ? automationResult.data : "needs_approval"}
      automationLoadFailed={!automationResult.ok}
    />
  );
}
