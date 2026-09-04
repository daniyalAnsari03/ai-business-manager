import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import { findById, resolveProduct, toolFail, toolOk } from "@/lib/ai/tools/shared";
import { getProducts } from "@/lib/products/service";
import type { Product } from "@/lib/products/types";
import { createDraftForProduct } from "@/lib/marketing/social-posts";

/**
 * Marketing controlled tool — phase 2 (reduced, per docs/phase2update.txt).
 *
 * `generate_product_caption`: turns ONE existing product into an AI-generated
 * `social_posts` draft. It resolves the product strictly within the caller's
 * own business, generates a real caption through the shared OpenAI Agents SDK
 * orchestration, saves the draft via the server-side service, then re-reads
 * the stored row and returns it as the verified result — nothing is faked.
 *
 * This tool is registered on the AI Business Manager so the chat can create
 * drafts too; the product-form flow reuses the same service underneath.
 */

function productSummary(product: Product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    imageUrl: product.imageUrl ?? null,
  };
}

export const generateProductCaptionTool = tool({
  name: "generate_product_caption",
  description:
    "Generate an AI marketing caption and hashtags for a product and save it as a reviewable draft post in the business's marketing activity. Use when the user asks something like 'product ka caption banao' or 'create a social post for this product'. Resolves the product from the business catalogue by name or id.",
  parameters: z.object({
    productName: z.string().trim().min(1).max(160).optional().nullable(),
    productId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact product ID when the user picked a specific candidate. Bypasses name search."),
  }),
  execute: async ({ productName, productId }) => {
    const productsResult = await getProducts();
    if (!productsResult.ok) {
      return toolFail("database_error", "Could not read products. Ask the user to try again.");
    }
    const products = productsResult.data;

    let match: { kind: "found"; item: Product } | { kind: "not_found" } | { kind: "ambiguous"; candidates: Product[] };
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

    const draftResult = await createDraftForProduct(match.item);
    if (!draftResult.ok) {
      return toolFail(
        draftResult.reason === "not_configured"
          ? "not_configured"
          : "database_error",
        draftResult.reason === "ai_unavailable"
          ? "The caption generation could not run right now. Ask the user to try again."
          : "Could not create the draft post. Do not claim success.",
      );
    }

    return toolOk({
      created: true,
      status: "draft",
      product: productSummary(match.item),
      caption_en: draftResult.data.captionEn,
      caption_ur: draftResult.data.captionUr,
      selected_language: draftResult.data.selectedLanguage,
      postId: draftResult.data.id,
    });
  },
});
