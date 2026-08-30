import "server-only";

import { Agent, run, user } from "@openai/agents";

import { createBusinessManagerModel } from "@/lib/ai/model-provider";
import { getCurrency } from "@/lib/business/constants";
import type { Language } from "@/lib/business/types";

/**
 * AI caption generator — Phase 2 (reduced, per docs/phase2update.txt).
 *
 * This produces the caption + hashtags behind an automatically created social
 * "draft" post, through the SAME OpenAI Agents SDK orchestration the AI
 * Business Manager chat uses. It reuses the shared model binding
 * (createBusinessManagerModel) so provider failover and switching behaviour
 * stay identical to the rest of the app — there is deliberately NO separate
 * or parallel AI call path.
 *
 * The agent is told to return PLAIN TEXT (a caption followed by a line of
 * hashtags). This keeps output provider-robust — no structured-output schema
 * that the OpenAI/Gemini/Groq failover chain could reject with format errors.
 */

export type CaptionGeneratorResult =
  | { ok: true; data: { caption: string } }
  | { ok: false; reason: "not_configured" | "ai_failed" | "empty" };

export interface CaptionProductContext {
  productName: string;
  category: string;
  price: number;
  currencyCode: string;
  imageUrl: string | null;
  language: Language;
}

/** Builds the language-aware caption writing instructions. */
function buildCaptionInstructions(params: CaptionProductContext): string {
  const { language } = params;
  if (language === "ur") {
    return [
      "You write Instagram marketing captions for a small business owner.",
      "Rule 1 — write the caption ONLY in simple Roman Urdu (Urdu in English letters), warm and easy for a non-technical customer, e.g. 'Black Kurta ab fresh stock mein maujood hai!'.",
      "Rule 2 — keep it short (2-4 short sentences).",
      "Rule 3 — end with 4-6 relevant hashtags on their own line (hashtags stay in English as-is, e.g. #Kurta #Fashion).",
      "Output ONLY the finished caption text with the hashtag line at the end. Nothing else — no explanations, no quotes, no labels.",
    ].join("\n");
  }
  return [
    "You write Instagram marketing captions for a small business owner.",
    "Rule 1 — write the caption ONLY in clear, simple English, warm and friendly for customers.",
    "Rule 2 — keep it short (2-4 short sentences).",
    "Rule 3 — end with 4-6 relevant hashtags on their own line (e.g. #Fashion #NewArrivals).",
    "Output ONLY the finished caption text with the hashtag line at the end. Nothing else — no explanations, no quotes, no labels.",
  ].join("\n");
}

/**
 * Parses the agent's plain-text output into a caption. Hashtags are appended
 * to the caption as a final line (the `social_posts` table stores the whole
 * caption; there is no separate hashtags column).
 */
function parseCaption(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const cleaned = trimmed
    // Strip leading/trailing markdown-style quotes the model sometimes adds.
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
  if (!cleaned) return "";
  // Normalise a trailing hashtag run: ensure exactly one blank line bound
  // between the body and the hashtags where the model wrote them inline.
  const tagsMatch = cleaned.match(/(?:^|\s)(#[A-Za-z0-9_]+(?:\s+#[A-Za-z0-9_]+){1,5})$/);
  let caption = cleaned;
  if (tagsMatch) {
    const tags = cleaned.slice(tagsMatch.index ?? 0).trim();
    const body = cleaned.slice(0, tagsMatch.index ?? 0).trim();
    caption = body ? `${body}\n\n${tags}` : tags;
  }
  return caption;
}

/**
 * Generates a caption + hashtags for a product using the shared Agents SDK
 * orchestration. Runs a focused, tools-less agent so the output is pure text
 * and the same model/failover chain is reused. Safe to call server-side only.
 */
export async function generateProductCaption(
  params: CaptionProductContext,
): Promise<CaptionGeneratorResult> {
  const symbol = getCurrency(params.currencyCode)?.symbol ?? "Rs.";
  const priceText = `${symbol} ${params.price.toLocaleString("en-US")}`;

  const agent = new Agent({
    name: "Product Caption Writer",
    instructions: buildCaptionInstructions(params),
    model: createBusinessManagerModel(),
    modelSettings: {
      // No temperature is set on purpose: the resolved provider model defines
      // its own default, and some models in the failover chain only accept the
      // default value. Setting a custom temperature here risks a request-shape
      // rejection that the router treats as futile (no backup engaged).
      maxTokens: 512,
    },
  });

  const prompt = [
    `Write a short marketing caption for this product:`,
    `- Name: ${params.productName}`,
    `- Category: ${params.category}`,
    `- Price: ${priceText}`,
    params.imageUrl
      ? `- An image of the product is available (you can describe it in the caption if helpful): ${params.imageUrl}`
      : "- No image is attached.",
  ].join("\n");

  try {
    const result = await run(agent, [user(prompt)], {
      maxTurns: 2,
    });
    const caption = parseCaption(String(result.finalOutput ?? "").trim());
    if (!caption) return { ok: false, reason: "empty" };
    return { ok: true, data: { caption } };
  } catch (error) {
    // The shared model chain can fail (rate limits, provider errors). Log a
    // secret-free diagnostic and report `ai_failed` so the caller can decide
    // whether to block the underlying flow. `not_configured` originates only
    // from createBusinessManagerModel when no provider key exists.
    console.error(
      "[caption-generator] caption generation failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, reason: "ai_failed" };
  }
}
