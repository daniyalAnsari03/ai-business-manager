import "server-only";

import { Agent, run, user } from "@openai/agents";
import { createBusinessManagerModel } from "@/lib/ai/model-provider";
import type { Language } from "@/lib/business/types";

/**
 * Video AI content generator — Phase 4.
 *
 * Uses the SAME AI architecture as the rest of the app (the shared model
 * provider / OpenAI Agents SDK orchestration) to generate, from the business
 * context we are GIVEN (product, category, business type, language) — NOT from
 * visual analysis of the video, which the current pipeline does not support —
 * a bilingual caption, relevant hashtags and a suggested posting time.
 *
 * Because there is no audience analytics source, the suggested posting time is
 * always labelled on the UI as an AI recommendation, never as real analytics.
 */

export type VideoContentResult =
  | {
      ok: true;
      data: {
        captionEn: string;
        captionUr: string;
        hashtags: string;
        suggestedPostTime: string;
      };
    }
  | { ok: false; reason: "not_configured" | "ai_failed" | "empty" };

export interface VideoContentData {
  captionEn: string;
  captionUr: string;
  hashtags: string;
  suggestedPostTime: string;
}

export interface VideoContentContext {
  businessName: string;
  businessType: string;
  productName?: string | null;
  language: Language;
}

const EN_DELIMITER = "###EN###";
const UR_DELIMITER = "###UR###";
const TAGS_DELIMITER = "###TAGS###";
const TIME_DELIMITER = "###TIME###";

function buildInstructions(): string {
  return [
    "You generate social media content for a video a small business wants to post.",
    "Produce all of the following from the context you are given:",
    "",
    "1. A short ENGAGING caption in ENGLISH (2-3 sentences).",
    "2. The SAME caption in simple ROMAN URDU (Urdu in English letters).",
    "3. 4-6 RELEVANT, non-spammy hashtags (English, as-is).",
    "4. A suggested posting time as a 24-hour HH:MM string (e.g. 19:30).",
    "   Base this on a sensible time when the business's customers are likely free",
    "   — it is an AI RECOMMENDATION, not real audience analytics.",
    "",
    "OUTPUT FORMAT (exactly this structure, nothing else):",
    "###EN###",
    "(english caption)",
    "###UR###",
    "(roman urdu caption)",
    "###TAGS###",
    "(hashtags here, space separated)",
    "###TIME###",
    "(HH:MM)",
  ].join("\n");
}

function parse(text: string): VideoContentData | null {
  const clean = text.replace(/^```/, "").replace(/```$/, "").trim();
  const extract = (delim: string): string => {
    const start = clean.indexOf(delim);
    if (start === -1) return "";
    const rest = clean.slice(start + delim.length);
    const end = Math.min(
      ...[EN_DELIMITER, UR_DELIMITER, TAGS_DELIMITER, TIME_DELIMITER]
        .filter((d) => rest.indexOf(d) !== -1)
        .map((d) => rest.indexOf(d)),
    );
    const slice = end === Infinity ? rest : rest.slice(0, end);
    return slice.trim();
  };

  const captionEn = extract(EN_DELIMITER);
  const captionUr = extract(UR_DELIMITER);
  const hashtags = extract(TAGS_DELIMITER);
  const time = extract(TIME_DELIMITER);

  if (!captionEn && !captionUr) return null;
  return {
    captionEn: captionEn || captionUr,
    captionUr: captionUr || captionEn,
    hashtags: hashtags || "#Business",
    suggestedPostTime: /^\d{2}:\d{2}$/.test(time) ? time : "19:30",
  };
}

/**
 * Generates bilingual caption, hashtags and a suggested posting HH:MM time
 * for a video. Uses the shared AI model provider (never a separate provider).
 */
export async function generateVideoContent(
  context: VideoContentContext,
): Promise<VideoContentResult> {
  const agent = new Agent({
    name: "Video Content Writer",
    instructions: buildInstructions(),
    model: createBusinessManagerModel(),
    modelSettings: { maxTokens: 1024 },
  });

  const lines = [
    `Business: ${context.businessName}`,
    `Business type: ${context.businessType}`,
    context.productName ? `Product: ${context.productName}` : "No specific product.",
    "",
    "Generate the content in the required format.",
  ].join("\n");

  try {
    const result = await run(agent, [user(lines)], { maxTurns: 2 });
    const parsed = parse(String(result.finalOutput ?? "").trim());
    if (!parsed) return { ok: false, reason: "empty" };
    return { ok: true, data: parsed };
  } catch (error) {
    console.error(
      "[video-content] generation failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, reason: "ai_failed" };
  }
}
