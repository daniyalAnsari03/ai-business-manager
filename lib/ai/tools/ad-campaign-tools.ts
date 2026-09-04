import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import { findById, resolveProduct, toolFail } from "@/lib/ai/tools/shared";
import { getProducts } from "@/lib/products/service";
import type { Product } from "@/lib/products/types";
import { getMetaAdsConnection } from "@/lib/marketing/service";

/**
 * Ad campaign controlled tool — Phase 0 (Connect Meta Ads, reduced scope).
 *
 * Responsible for the "is product ki ad chalao" style request. It follows the
 * exact AGENTS.md Section 8 chain:
 *
 *   User → AI Agent → this controlled tool → server-side service → Supabase → verified result
 *
 * Phase-0 behaviour is intentionally HONEST about the reduced scope:
 *  - If the business has NOT connected a Meta Ad Account, the tool returns a
 *    clear, localized message telling the user to connect it in Settings, and
 *    it does NOT create any fake or pending campaign row that would imply
 *    something happened. (docs/phase0.txt §4)
 *  - If the business HAS connected a Meta Ad Account, the real Meta Marketing
 *    API call does not exist yet — that branch is stubbed with a clear status
 *    and a marker for the follow-up phase that adds live campaign creation.
 *
 * This tool never claims success it did not achieve.
 */

function productSummary(product: Product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
  };
}

export const createAdCampaignTool = tool({
  name: "create_ad_campaign",
  description:
    "Start an ad campaign for a product (for example 'is product ki ad chalao'). Checks whether the business has connected its Meta Ad Account first, and only a connected account can run real ads. When not connected it tells the user honestly to connect Meta Ads in Settings — it never pretends to create an ad.",
  parameters: z.object({
    productName: z.string().trim().min(1).max(160).optional().nullable(),
    productId: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .nullable()
      .describe("Exact product ID when the user picked a specific candidate. Bypasses name search."),
    suggestedDailyBudget: z
      .number()
      .positive()
      .max(1_000_000_000)
      .optional()
      .nullable()
      .describe("Optional preferred daily budget for the campaign, in the business's currency."),
  }),
  execute: async ({ productName, productId, suggestedDailyBudget }) => {
    // Which product does the user want to advertise? Resolve it strictly within
    // the caller's own business (never trust a foreign id).
    const productsResult = await getProducts();
    if (!productsResult.ok) {
      return toolFail("database_error", "Could not read products. Tell the user to try again.");
    }
    const products = productsResult.data;

    let match:
      | { kind: "found"; item: Product }
      | { kind: "not_found" }
      | { kind: "ambiguous"; candidates: Product[] };
    if (productId) {
      const byId = findById(products, productId);
      match = byId ? { kind: "found", item: byId } : { kind: "not_found" };
    } else {
      match = resolveProduct(productName ?? "", products);
    }

    if (match.kind === "not_found") {
      return toolFail("not_found", "No such product. Tell the user honestly.");
    }
    if (match.kind === "ambiguous") {
      return toolFail(
        "ambiguous",
        "Several products match. Ask the user which one they mean, then pass its productId.",
      );
    }

    // ---- Connection check: does this business have a connected Meta Ad Account? ----
    const connectionResult = await getMetaAdsConnection();
    if (!connectionResult.ok) {
      return toolFail(
        connectionResult.reason === "not_configured"
          ? "not_configured"
          : "database_error",
        "Could not check the Meta Ads connection. Tell the user to try again.",
      );
    }

    if (!connectionResult.data.connected) {
      // Honest not-connected fallback. We deliberately do NOT create a fake or
      // pending campaign row here — that would imply the ad was queued when it
      // was not (docs/phase0.txt §4).
      return toolFail(
        "meta_ads_not_connected",
        "The business has no connected Meta Ad Account. Tell the user: 'Meta Ads account connect nahi hai. Settings mein connect karein.' (or correctly localized) and mention that no ad was created.",
      );
    }

    // ---------------------------------------------------------------------------
    // CONNECTED BRANCH — real campaign creation is NOT implemented in this
    // reduced-scope phase (docs/phase0.txt §4). It requires the app owner to
    // finish Meta Developer registration (META_APP_ID / META_APP_SECRET) and a
    // later phase to call the Meta Marketing API here. For now we answer with a
    // clear, honest "not launched yet" state rather than faking a campaign.
    // ---------------------------------------------------------------------------
    const account = connectionResult.data.account;

    return JSON.stringify({
      reason: "not_implemented",
      hint: "Meta Ads account is connected, but live campaign creation is not available yet in this version. Tell the user honestly that launching the ad will be possible in an upcoming update, and that no ad has been created yet.",
      product: productSummary(match.item),
      connected: true,
      ad_account_name: account?.adAccountName ?? null,
      requested_daily_budget: suggestedDailyBudget ?? null,
      status: "not_implemented",
    });
  },
});
