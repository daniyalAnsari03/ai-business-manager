/** Marketing module types — Phase 1 (foundation only). */

export const MARKETING_PLATFORMS = [
  "instagram",
  "facebook",
  "google_ads",
  "whatsapp",
  "meta_ads",
] as const;
export type MarketingPlatform = (typeof MARKETING_PLATFORMS)[number];

export function isMarketingPlatform(value: string): value is MarketingPlatform {
  return (MARKETING_PLATFORMS as readonly string[]).includes(value);
}

/** Channels a business can post to (campaigns/goals may also target others). */
export const SOCIAL_POST_PLATFORMS = ["instagram", "facebook"] as const;
export type SocialPostPlatform = (typeof SOCIAL_POST_PLATFORMS)[number];

export function isSocialPostPlatform(
  value: string,
): value is SocialPostPlatform {
  return (SOCIAL_POST_PLATFORMS as readonly string[]).includes(value);
}

export const SOCIAL_POST_STATUSES = [
  "draft",
  "scheduled",
  "published",
  "failed",
] as const;
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];

export const AD_CAMPAIGN_STATUSES = [
  "draft",
  "pending_connection",
  "active",
  "paused",
  "completed",
] as const;
export type AdCampaignStatus = (typeof AD_CAMPAIGN_STATUSES)[number];

export const AD_CAMPAIGN_GOALS = ["whatsapp", "website", "profile"] as const;
export type AdCampaignGoal = (typeof AD_CAMPAIGN_GOALS)[number];

export const CONNECTED_ACCOUNT_STATUSES = [
  "not_connected",
  "connected",
] as const;
export type ConnectedAccountStatus = (typeof CONNECTED_ACCOUNT_STATUSES)[number];

/** The channels the Settings section always lists (Phase 0 adds Meta Ads). */
export const SETTINGS_PLATFORMS: readonly MarketingPlatform[] = [
  "instagram",
  "facebook",
  "google_ads",
  "whatsapp",
  "meta_ads",
];

export interface SocialPost {
  id: string;
  businessId: string;
  productId: string | null;
  platform: SocialPostPlatform;
  /** Currently selected caption (mirrors caption_ur or caption_en). */
  caption: string | null;
  /** Roman Urdu caption variant (Phase 2.5). */
  captionUr: string | null;
  /** English caption variant (Phase 2.5). */
  captionEn: string | null;
  /** Which language variant is selected for this post ("en" | "ur"). */
  selectedLanguage: "en" | "ur";
  mediaUrl: string | null;
  status: SocialPostStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdCampaign {
  id: string;
  businessId: string;
  socialPostId: string | null;
  platform: MarketingPlatform;
  budget: number;
  spent: number;
  /** Suggested per-day budget for the current month (Phase 0 budget planner). */
  dailyBudget: number;
  /** Owner-set monthly cap this campaign should respect. Null = no cap. */
  monthlyBudgetCap: number | null;
  /** Live spend so far on this campaign. */
  spendToDate: number;
  status: AdCampaignStatus;
  goal: AdCampaignGoal;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingWallet {
  id: string;
  businessId: string;
  balance: number;
  monthlyBudgetCap: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectedAccount {
  id: string;
  businessId: string;
  platform: MarketingPlatform;
  status: ConnectedAccountStatus;
  accountLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A business's linked Meta Ad Account (Phase 0, reduced scope). The status in
 * `connected_accounts` (platform "meta_ads") is the authoritative connection
 * flag; this row carries the account identity (id/name) the owner connected.
 * No ad money ever flows through here — Meta handles the ad account funding.
 */
export interface MetaAdAccount {
  id: string;
  businessId: string;
  adAccountId: string | null;
  adAccountName: string | null;
  status: ConnectedAccountStatus;
  connectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Real metric values shown on the Marketing tab. Every number is read from
 * the marketing tables (0/empty while there is no activity — never mock).
 */
export interface MarketingMetrics {
  /** social_posts created in the current week (Monday → now). */
  postsThisWeek: number;
  /** Sum of spent_amount across all ad campaigns (all time). */
  adSpend: number;
  /**
   * Revenue attributed to ads. No attribution source exists in Phase 1, so
   * the honest value is 0 whenever campaign spend is 0 — never fabricated.
   */
  salesFromAds: number;
}

// ---------------------------------------------------------------------------
// Wallet transaction ledger — Phase 3
// ---------------------------------------------------------------------------

export const WALLET_TRANSACTION_TYPES = ["topup", "spend", "adjustment"] as const;
export type WalletTransactionType = (typeof WALLET_TRANSACTION_TYPES)[number];

export const WALLET_TRANSACTION_STATUSES = [
  "pending",
  "completed",
  "failed",
] as const;
export type WalletTransactionStatus =
  (typeof WALLET_TRANSACTION_STATUSES)[number];

/**
 * Immutable ledger row. Every change to marketing_wallet.balance must have
 * a corresponding completed row here — the balance alone is not sufficient.
 */
export interface WalletTransaction {
  id: string;
  businessId: string;
  type: WalletTransactionType;
  amount: number;
  balanceAfter: number;
  gatewayReference: string | null;
  description: string | null;
  status: WalletTransactionStatus;
  createdAt: string;
}