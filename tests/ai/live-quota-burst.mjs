/**
 * LIVE quota-exhaustion burst reproduction (docs/check.txt — Groq backup
 * skipped behind a misclassified 400).
 *
 * Drives the REAL production model wiring (model-provider → gemini-router →
 * groq-provider → Agents SDK runner) against the REAL network with the REAL
 * .env.local configuration, firing CONSECUTIVE multi-turn runs BACK-TO-BACK
 * with NO state reset — mirroring a user hammering the chat until every
 * Gemini slot rate-limits. The goal is to surface the exact upstream status +
 * body of any response that the router currently passes through as "success"
 * (new diagnostic logging) and to see whether Groq engages once the whole
 * chain is exhausted.
 *
 * Only tiny synthetic messages are sent; no business data is touched; keys
 * and bodies are never printed by this harness itself (the router prints
 * truncated diagnostic bodies for misclassified responses only).
 *
 * Run:
 *   node --env-file=.env.local --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/live-quota-burst.mjs [runs]
 */

const RUN_COUNT = Number(process.argv[2] ?? "12");

/* -------------------------------------------------------------------------
 * Transport observability: wrap global fetch BEFORE app modules load so the
 * router's `fetchImpl: fetch` capture sees this wrapper. Logs status codes
 * only — never headers or keys.
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
const { Agent, run, tool } = agents;
const userMessage = agents.user;
const assistantMessage = agents.assistant;
const { z } = await import("zod");
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
  if (error instanceof Error) return `unclassified:${error.name}: ${error.message.slice(0, 200)}`;
  return `unclassified:${String(error)}`;
}

await withTrace("live-quota-burst", async () => {
  console.log(`GEMINI SLOTS CONFIGURED: ${getGeminiProviders().length}`);
  console.log(`GROQ BACKUP: ${getGroqConfig() ? "configured" : "MISSING"}`);

  /* ---- Step 0: skip health scan when BURST_ONLY=1 ----------------------- */
  if (process.env.BURST_ONLY !== "1") {
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
        try {
          await response.arrayBuffer();
        } catch {}
      } catch (error) {
        console.log(`slot ${provider.slot}: NETWORK-ERROR (${error?.name ?? "unknown"})`);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  /* ---- Burst: consecutive REAL runner requests, no resets --------------- */
  console.log(`\n--- ${RUN_COUNT} BACK-TO-BACK RUNS (no reset, no delay) ---`);

  // One tiny read-only tool so every run is MULTI-TURN (tool turn + final
  // turn) like production chat, doubling model requests per run and burning
  // per-minute quota realistically. The tool never touches storage.
  let clockCalls = 0;
  const clockTool = tool({
    name: "probe_clock",
    description: "Returns a test counter value.",
    parameters: z.object({}),
    execute: async () => {
      clockCalls += 1;
      return { status: "ok", tick: clockCalls };
    },
  });

  const model = createBusinessManagerModel();
  const agent = new Agent({
    name: "AI Business Manager",
    instructions:
      "You are a business manager assistant. Always call probe_clock once, " +
      "then reply in one short sentence mentioning the tick value.",
    model,
    tools: [clockTool],
    modelSettings: { temperature: 0.3, maxTokens: 200 },
  });

  /** History accumulates EXACTLY like the browser client does. */
  const history = [];

  for (let i = 1; i <= RUN_COUNT; i += 1) {
    const text = `Burst message ${i}: call the probe tool, then answer briefly.`;
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
