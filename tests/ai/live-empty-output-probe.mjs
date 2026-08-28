/**
 * Live probe: does the configured model return EMPTY visible content when
 * maxTokens truncates (e.g. reasoning tokens consuming the budget)?
 * Mirrors lib/ai/agent.ts modelSettings (temperature 0.3, maxTokens 1200)
 * against the REAL providers with tiny prompts. Never prints keys.
 *
 * Run: node --env-file=.env.local tests/ai/live-empty-output-probe.mjs
 */

const GEMINI_BASE =
  process.env.GEMINI_BASE_URL?.trim() ||
  "https://generativelanguage.googleapis.com/v1beta/openai/";
const GROQ_BASE = "https://api.groq.com/openai/v1/";

async function probe(label, base, apiKey, model, maxTokens, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${base}chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });
    const body = await res.json();
    if (!res.ok) {
      console.log(`${label}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 160)}`);
      return;
    }
    const choice = body.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    const reasoningKeys = Object.keys(msg).filter((k) =>
      /reason|thinking/i.test(k),
    );
    console.log(
      `${label}: finish=${choice.finish_reason} contentLen=${(msg.content ?? "").length} ` +
        `reasoningFields=[${reasoningKeys.join(",")}] ` +
        `usage=${JSON.stringify(body.usage?.completion_tokens_details ?? {})} ` +
        `contentPreview="${(msg.content ?? "").slice(0, 80)}"`,
    );
  } catch (error) {
    console.log(`${label}: ERROR ${error?.name ?? String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

const geminiKey = process.env.GEMINI_API_KEY_2 ?? "";
const groqKey = process.env.GROQ_API_KEY ?? "";
const geminiModel = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const groqModel = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

// A prompt that invites visible reasoning/list work, like "kharche detail do".
const LIST_PROMPT =
  "Mere store ki aaj ki details ke sath ek chhoti report likho: sales, kharche, stock. Roman Urdu mein 8-10 lines.";

console.log("--- Gemini (slot 2 key) ---");
await probe("gemini max_tokens=1200 ", GEMINI_BASE, geminiKey, geminiModel, 1200, LIST_PROMPT);
await probe("gemini max_tokens=32   ", GEMINI_BASE, geminiKey, geminiModel, 32, LIST_PROMPT);

console.log("--- Groq ---");
if (groqKey) {
  await probe("groq   max_tokens=1200 ", GROQ_BASE, groqKey, groqModel, 1200, LIST_PROMPT);
  await probe("groq   max_tokens=32   ", GROQ_BASE, groqKey, groqModel, 32, LIST_PROMPT);
} else {
  console.log("groq: not configured");
}
