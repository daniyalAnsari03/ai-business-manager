/**
 * Prompt 12 / STEP 15 TEST 7 — LIVE application-path fallback check.
 *
 * Uses the REAL production model wiring (model-provider → gemini-router →
 * groq-provider → Agents SDK) against the REAL network, with all Gemini keys
 * overridden IN THIS PROCESS ONLY to force the Groq backup. `.env.local` and
 * real credentials are never modified. One tiny non-destructive completion.
 *
 * Run: node --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/live-fallback.mjs
 */

process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
for (let slot = 1; slot <= 8; slot += 1) {
  // Force every Gemini slot to fail authentication — process-local only.
  process.env[`GEMINI_API_KEY_${slot}`] = "invalid-forced-failover-check";
}
// Keep GROQ_* from .env.local untouched.

const summary = [];
function log(line) {
  summary.push(line);
  console.log(line);
}

const { withTrace } = await import("@openai/agents");
const { createBusinessManagerModel } = await import("../../lib/ai/model-provider.ts");
const { getGroqConfig } = await import("../../lib/ai/groq-config.ts");

await withTrace("live-fallback-check", async () => {
  const config = getGroqConfig();
  log(`GROQ_API_KEY: ${config ? "configured" : "MISSING"}`);
  log(`GROQ_MODEL: ${config?.model ?? "n/a"}`);
  if (!config) {
    log("RESULT: FAIL (no backup configuration)");
    return;
  }

  const model = createBusinessManagerModel();

  // Mirrors lib/ai/agent.ts modelSettings exactly.
  const request = {
    systemInstructions: "You are the AI Business Manager. Reply briefly.",
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "Reply with exactly: OK" }] },
    ],
    modelSettings: { temperature: 0.3, maxTokens: 1200 },
    tools: [],
    handoffs: [],
    // Production runners serialize a text-output agent as the literal string.
    outputType: "text",
    tracing: false,
  };

  /* ---- Non-streaming path ------------------------------------------------ */
  try {
    const started = Date.now();
    const response = await model.getResponse(request);
    const text = response.output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content)
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    log(`NON-STREAMING: transport success (${Date.now() - started}ms)`);
    log(`NON-STREAMING TEXT: "${text.slice(0, 80)}"`);
    log(
      text
        ? "NON-STREAMING RESULT: SUCCESS (Groq served the request)"
        : "NON-STREAMING RESULT: FAIL (empty content — reasoning tokens likely consumed the budget)",
    );
  } catch (error) {
    const name = error?.name ?? "unknown";
    const code = error?.code ?? "";
    log(`NON-STREAMING RESULT: FAIL (${name}${code ? `:${code}` : ""})`);
    log(`DETAIL: ${String(error?.message ?? error).replace(/gsk_[A-Za-z0-9]+/g, "[redacted]").slice(0, 200)}`);
  }

  /* ---- Streaming path ----------------------------------------------------- */
  try {
    let streamed = "";
    for await (const event of model.getStreamedResponse(request)) {
      if (event.type === "output_text_delta") streamed += event.delta ?? "";
    }
    log(`STREAMING TEXT: "${streamed.trim().slice(0, 80)}"`);
    log(streamed.trim() ? "STREAMING RESULT: SUCCESS" : "STREAMING RESULT: FAIL (empty stream content)");
  } catch (error) {
    const name = error?.name ?? "unknown";
    const code = error?.code ?? "";
    log(`STREAMING RESULT: FAIL (${name}${code ? `:${code}` : ""})`);
  }
});
