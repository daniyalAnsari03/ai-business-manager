/**
 * Captures the exact chat-completions body the Agents SDK sends to Groq
 * (secrets never printed). Run:
 * node --env-file=.env.local --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/groq-body-probe.mjs
 */

process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
for (let slot = 1; slot <= 8; slot += 1) {
  process.env[`GEMINI_API_KEY_${slot}`] = "invalid-forced-failover-check";
}

const realFetch = globalThis.fetch;
globalThis.fetch = async function capturingFetch(url, init = {}) {
  const target = String(url);
  if (target.includes("api.groq.com") && typeof init.body === "string") {
    console.log("=== GROQ REQUEST URL:", target);
    console.log("=== GROQ REQUEST BODY:");
    try {
      const parsed = JSON.parse(init.body);
      console.log(JSON.stringify(parsed, null, 2).slice(0, 3000));
    } catch {
      console.log(init.body.slice(0, 2000));
    }
    // Return a harmless stub so the flow ends quickly without another call.
    return Response.json(
      { id: "x", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      { status: 200 },
    );
  }
  return realFetch(url, init);
};

const { withTrace } = await import("@openai/agents");
const { createBusinessManagerModel } = await import("../../lib/ai/model-provider.ts");

await withTrace("groq-body-probe", async () => {
  const model = createBusinessManagerModel();
  try {
    await model.getResponse({
      systemInstructions: "You are the AI Business Manager.",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Reply with exactly: OK" }] }],
      modelSettings: { temperature: 0.3, maxTokens: 1200 },
      tools: [],
      handoffs: [],
      outputType: { type: "text" },
      tracing: false,
    });
  } catch (error) {
    console.log("(flow ended:", error?.name ?? "unknown", ")");
  }
});
