/**
 * LIVE consecutive-request reproduction (docs/check.txt Rule 26).
 *
 * Drives the REAL production model wiring (model-provider → gemini-router →
 * groq-provider → Agents SDK runner) against the REAL network with the REAL
 * .env.local configuration, across several CONSECUTIVE requests WITHOUT any
 * state reset and WITHOUT a history reset — mirroring the browser sending
 * message after message. Each request passes an ARRAY input with accumulated
 * history exactly like app/api/ai/chat/route.ts builds it.
 *
 * A per-slot health scan runs first so "all Gemini failed" claims can be
 * checked against reality. Only tiny requests are made; no business data is
 * touched; no keys are printed.
 *
 * Run:
 *   node --env-file=.env.local --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/live-consecutive.mjs [runs]
 */

const RUN_COUNT = Number(process.argv[2] ?? "6");

/* -------------------------------------------------------------------------
 * Transport observability: wrap global fetch BEFORE app modules load so the
 * router's `fetchImpl: fetch` capture sees this wrapper. Logs status codes
 * only — never headers, keys or bodies.
 * ---------------------------------------------------------------------- */
const attemptLog = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async function observedFetch(url, init = {}) {
  const started = Date.now();
  try {
    const response = await realFetch(url, init);
    attemptLog.push({
      host: String(url).includes("groq") ? "groq" : "gemini",
      status: response.status,
      ms: Date.now() - started,
    });
    return response;
  } catch (error) {
    attemptLog.push({
      host: String(url).includes("groq") ? "groq" : "gemini",
      status: "network-error",
      ms: Date.now() - started,
    });
    throw error;
  }
};

process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://stub.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "stub-anon-key";

const { withTrace } = await import("@openai/agents");
const agents = await import("@openai/agents");
const { Agent, run } = agents;
const userMessage = agents.user;
const assistantMessage = agents.assistant;
const { createBusinessManagerModel } = await import("../../lib/ai/model-provider.ts");
const { getGeminiProviders } = await import("../../lib/ai/gemini-config.ts");
const { getGroqConfig } = await import("../../lib/ai/groq-config.ts");
const { findErrorInCauseChain, GeminiRouterError } = await import(
  "../../lib/ai/gemini-router.ts"
);
const { GroqProviderError } = await import("../../lib/ai/groq-provider.ts");

function classify(error) {
  const found = findErrorInCauseChain(error, (candidate) => {
    return (
      candidate instanceof GeminiRouterError ||
      candidate instanceof GroqProviderError
    );
  });
  if (found) return `${found.name}:${found.code}`;
  if (error instanceof Error) return `unclassified:${error.name}`;
  return `unclassified:${String(error)}`;
}

await withTrace("live-consecutive", async () => {
  console.log(`GEMINI SLOTS CONFIGURED: ${getGeminiProviders().length}`);
  console.log(`GROQ BACKUP: ${getGroqConfig() ? "configured" : "MISSING"}`);

  /* ---- Step 1: per-slot health scan (one tiny request per key) ---------- */
  console.log("\n--- SLOT HEALTH SCAN ---");
  const providers = getGeminiProviders();
  for (const provider of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await realFetch(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.GEMINI_MODEL,
            messages: [{ role: "user", content: "Reply with exactly: OK" }],
            max_tokens: 5,
            stream: false,
          }),
          signal: controller.signal,
        },
      );
      console.log(`slot ${provider.slot}: HTTP ${response.status}`);
      // Drain body so sockets close promptly.
      try {
        await response.arrayBuffer();
      } catch {}
    } catch (error) {
      console.log(`slot ${provider.slot}: NETWORK-ERROR (${error?.name ?? "unknown"})`);
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---- Step 2: consecutive REAL runner requests, no resets -------------- */
  console.log(`\n--- ${RUN_COUNT} CONSECUTIVE RUNNER REQUESTS (no reset, no refresh) ---`);
  const model = createBusinessManagerModel();
  const agent = new Agent({
    name: "AI Business Manager",
    instructions:
      "You are a business manager assistant. Reply in one short sentence in Roman Urdu.",
    model,
    tools: [],
    modelSettings: { temperature: 0.3, maxTokens: 200 },
  });

  /** History accumulates EXACTLY like the browser client does. */
  const history = [];

  for (let i = 1; i <= RUN_COUNT; i += 1) {
    const text = `Test message number ${i}: reply with one short sentence.`;
    const input = [
      ...history.map((m) =>
        m.role === "user" ? userMessage(m.content) : assistantMessage(m.content),
      ),
      userMessage(text),
    ];

    const started = Date.now();
    attemptLog.length = 0;
    let outcome;
    let finalText = "";
    try {
      const result = await run(agent, input, { stream: true, maxTurns: 14 });
      for await (const event of result) {
        void event; // consume exactly like route.ts
      }
      finalText = (result.finalOutput ?? "").toString().trim();
      outcome = finalText ? "OK" : "EMPTY_FINAL_OUTPUT";
    } catch (error) {
      outcome = `ERROR ${classify(error)}`;
    }
    const attempts = attemptLog
      .map((a) => `${a.host}:${a.status}`)
      .join(",");
    console.log(
      `REQ ${i} -> ${outcome} (${Date.now() - started}ms) attempts=[${attempts}]`,
    );
    if (finalText) {
      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: finalText.slice(0, 500) });
    }
  }

  console.log("\nDONE");
});
