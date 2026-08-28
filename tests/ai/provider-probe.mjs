/**
 * Prompt 12 diagnostic probes (read-only, harmless):
 *  1. Checks every configured Gemini slot against the real endpoint using
 *     models.list — no generations, no token usage, no secrets printed.
 *  2. Sends the app-shaped chat request (max_tokens: 1200) to real Groq once,
 *     reporting only outcome categories.
 *
 * Run: node --env-file=.env.local --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/provider-probe.mjs
 */

const { getGeminiProviders, getGeminiModelName } = await import("../../lib/ai/gemini-config.ts");
const { GEMINI_OPENAI_BASE_URL } = await import("../../lib/ai/gemini-router.ts");
const { getGroqConfig } = await import("../../lib/ai/groq-config.ts");

/* ---- 1. Gemini slot validity (read-only) -------------------------------- */

console.log(`GEMINI MODEL: ${getGeminiModelName()}`);
for (const provider of getGeminiProviders()) {
  try {
    const response = await fetch(new URL("models", GEMINI_OPENAI_BASE_URL), {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    let category = "unknown";
    if (response.ok) category = "valid";
    else if (response.status === 429) category = "rate_limited";
    else {
      const body = await response.text().catch(() => "");
      const parsed = (() => { try { return JSON.parse(body); } catch { return null; } })();
      const msg = String(parsed?.error?.message ?? "").slice(0, 60);
      category = `status=${response.status}${msg ? ` msg="${msg}"` : ""}`;
    }
    console.log(`GEMINI SLOT ${provider.slot}: ${category}`);
  } catch (error) {
    console.log(`GEMINI SLOT ${provider.slot}: NETWORK_FAIL (${error?.name ?? "unknown"})`);
  }
}

/* ---- 2. App-shaped Groq request ----------------------------------------- */

const config = getGroqConfig();
if (!config) {
  console.log("GROQ: MISSING configuration");
} else {
  async function groqProbe(label, extraBody) {
    const started = Date.now();
    const response = await fetch(new URL("chat/completions", config.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: "You are the AI Business Manager. Reply briefly." },
          { role: "user", content: "Reply with exactly: OK" },
        ],
        temperature: 0.3,
        ...extraBody,
        stream: false,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json().catch(() => null);
    const choice = payload?.choices?.[0];
    const content = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
    const finish = choice?.finish_reason ?? "none";
    const reasoningChars = typeof choice?.message?.reasoning === "string" ? choice.message.reasoning.length : 0;
    console.log(
      `${label}: status=${response.status} (${Date.now() - started}ms) finish=${finish} ` +
      `content_chars=${content.length} reasoning_chars=${reasoningChars} ` +
      `completion_tokens=${payload?.usage?.completion_tokens ?? "?"}`,
    );
    if (!response.ok) {
      console.log(`${label} ERROR BODY: ${JSON.stringify(payload?.error ?? payload).slice(0, 200)}`);
    }
  }

  try {
    // Exactly what lib/ai/agent.ts + Agents SDK send today.
    await groqProbe("GROQ APP-SHAPE (max_tokens=1200)", { max_tokens: 1200 });
  } catch (error) {
    console.log(`GROQ APP-SHAPE (max_tokens=1200): FAILED (${error?.name ?? "unknown"}: ${String(error?.message ?? error).slice(0, 140)})`);
  }
  try {
    // Candidate fix shape.
    await groqProbe("GROQ ALT-SHAPE (max_completion_tokens=2048)", { max_completion_tokens: 2048 });
  } catch (error) {
    console.log(`GROQ ALT-SHAPE: FAILED (${error?.name ?? "unknown"}: ${String(error?.message ?? error).slice(0, 140)})`);
  }
}
