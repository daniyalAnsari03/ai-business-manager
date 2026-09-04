import "server-only";

import { Agent, run, user } from "@openai/agents";

import { createBusinessManagerModel } from "@/lib/ai/model-provider";
import { getCurrency } from "@/lib/business/constants";
import type { Language } from "@/lib/business/types";

/**
 * AI caption generator — Phase 2.5 (bilingual captions).
 *
 * Produces BOTH Roman Urdu and English captions for a product in a single AI
 * call, so the two versions share the same creative context and represent the
 * same caption just in each language. This avoids two independent calls that
 * could produce inconsistent content.
 *
 * The agent returns PLAIN TEXT with a clear delimiter between languages.
 * This keeps output provider-robust — no structured-output schema that the
 * OpenAI/Gemini/Groq failover chain could reject with format errors.
 */

export type CaptionGeneratorResult =
  | { ok: true; data: { captionUr: string; captionEn: string } }
  | { ok: false; reason: "not_configured" | "ai_failed" | "empty" };

export interface CaptionProductContext {
  productName: string;
  category: string;
  price: number;
  currencyCode: string;
  imageUrl: string | null;
  language: Language;
}

/**
 * Builds the bilingual caption writing instructions. The agent writes BOTH
 * languages in a single response, separated by a clear delimiter.
 */
function buildBilingualCaptionInstructions(): string {
  return [
    "You write Instagram marketing captions for a small business owner.",
    "You must produce TWO versions of the same caption for this product:",
    "",
    "1. ENGLISH version — clear, simple English, warm and friendly for customers.",
    "2. ROMAN URDU version — simple Roman Urdu (Urdu in English letters), warm and easy for a non-technical customer, e.g. 'Black Kurta ab fresh stock mein maujood hai!'.",
    "",
    "Both versions must convey the same message/idea, just in different languages.",
    "",
    "RULES for BOTH versions:",
    "- Keep each caption short (2-4 short sentences).",
    "- End each caption with 4-6 relevant hashtags on their own line (hashtags stay in English as-is, e.g. #Kurta #Fashion).",
    "- The two versions should NOT be exact word-for-word translations — adapt the tone naturally for each language.",
    "",
    "OUTPUT FORMAT (exactly this structure):",
    "###EN###",
    "(English caption here)",
    "###UR###",
    "(Roman Urdu caption here)",
    "",
    "Nothing else — no explanations, no quotes, no labels outside the delimiter sections.",
  ].join("\n");
}

/** Delimiters used to separate the two language captions in the AI output. */
const EN_DELIMITER = "###EN###";
const UR_DELIMITER = "###UR###";

/**
 * Parses the agent's plain-text output into two caption strings.
 * Extracts the English and Roman Urdu sections from the delimited output.
 */
function parseBilingualCaptions(raw: string): { captionUr: string; captionEn: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const cleaned = trimmed
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
  if (!cleaned) return null;

  const enIdx = cleaned.indexOf(EN_DELIMITER);
  const urIdx = cleaned.indexOf(UR_DELIMITER);

  // If both delimiters are present, extract each section.
  if (enIdx !== -1 && urIdx !== -1) {
    const enSection = cleaned.slice(enIdx + EN_DELIMITER.length, urIdx).trim();
    const urSection = cleaned.slice(urIdx + UR_DELIMITER.length).trim();
    const captionEn = normaliseCaption(enSection);
    const captionUr = normaliseCaption(urSection);
    if (captionEn && captionUr) return { captionEn, captionUr };
  }

  // Fallback: try to find one or the other, or split on ### markers.
  const sections = cleaned.split(/###\w+###/).map((s) => s.trim()).filter(Boolean);
  if (sections.length >= 2) {
    // Heuristic: first section is English, second is Roman Urdu (matches the
    // instruction order).
    const captionEn = normaliseCaption(sections[0]);
    const captionUr = normaliseCaption(sections[1]);
    if (captionEn && captionUr) return { captionEn, captionUr };
  }

  // Last resort: if no delimiters found, treat the whole output as both
  // languages (identical — not ideal but preserves backward compat for a
  // single-language generation edge case).
  const fallback = normaliseCaption(cleaned);
  if (fallback) return { captionEn: fallback, captionUr: fallback };

  return null;
}

function normaliseCaption(text: string): string {
  if (!text) return "";
  // Strip wrapping markdown fences the model sometimes adds.
  const cleaned = text.replace(/^```/, "").replace(/```$/, "").trim();
  if (!cleaned) return "";
  // Normalise a trailing hashtag run.
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
 * Generates BOTH English and Roman Urdu captions in a single AI call, so the
 * two versions represent the same caption in each language. Returns both
 * versions. Safe to call server-side only.
 */
export async function generateProductCaption(
  params: CaptionProductContext,
): Promise<CaptionGeneratorResult> {
  const symbol = getCurrency(params.currencyCode)?.symbol ?? "Rs.";
  const priceText = `${symbol} ${params.price.toLocaleString("en-US")}`;

  const agent = new Agent({
    name: "Product Caption Writer",
    instructions: buildBilingualCaptionInstructions(),
    model: createBusinessManagerModel(),
    modelSettings: {
      // No temperature is set on purpose: the resolved provider model defines
      // its own default, and some models in the failover chain only accept the
      // default value. Setting a custom temperature here risks a request-shape
      // rejection that the router treats as futile (no backup engaged).
      maxTokens: 1024,
    },
  });

  const prompt = [
    `Write a short marketing caption for this product in BOTH English and Roman Urdu.`,
    `- Name: ${params.productName}`,
    `- Category: ${params.category}`,
    `- Price: ${priceText}`,
    params.imageUrl
      ? `- An image of the product is available (you can describe it in the caption if helpful): ${params.imageUrl}`
      : "- No image is attached.",
    "",
    "Produce both language versions using the required output format.",
  ].join("\n");

  try {
    const result = await run(agent, [user(prompt)], {
      maxTurns: 2,
    });
    const parsed = parseBilingualCaptions(String(result.finalOutput ?? "").trim());
    if (!parsed) return { ok: false, reason: "empty" };
    return { ok: true, data: parsed };
  } catch (error) {
    console.error(
      "[caption-generator] bilingual caption generation failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, reason: "ai_failed" };
  }
}
