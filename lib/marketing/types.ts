/** Marketing module types — Phase 1 (foundation only). */

export const MARKETING_PLATFORMS = [
  "instagram",
  "facebook",
  "google_ads",
  "whatsapp",
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

/** The four channels the Settings section always lists. */
export const SETTINGS_PLATFORMS: readonly MarketingPlatform[] = [
  "instagram",
  "facebook",
  "google_ads",
  "whatsapp",
];

export interface SocialPost {
  id: string;
  businessId: string;
  productId: string | null;
  platform: SocialPostPlatform;
  caption: string | null;
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