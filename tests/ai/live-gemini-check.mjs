/**
 * Positive live-path check: with the REAL configuration untouched, the
 * production model wiring must succeed via Gemini slot 1 (tiny request).
 * Run: node --env-file=.env.local --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/live-gemini-check.mjs
 */

const { withTrace } = await import("@openai/agents");
const { createBusinessManagerModel } = await import("../../lib/ai/model-provider.ts");
const { getGeminiProviders } = await import("../../lib/ai/gemini-config.ts");

await withTrace("live-gemini-check", async () => {
  console.log(`GEMINI SLOTS CONFIGURED: ${getGeminiProviders().length}`);
  const model = createBusinessManagerModel();
  const request = {
    systemInstructions: "You are the AI Business Manager.",
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "Reply with exactly: OK" }] },
    ],
    modelSettings: { temperature: 0.3, maxTokens: 1200 },
    tools: [],
    handoffs: [],
    outputType: "text",
    tracing: false,
  };
  try {
    const started = Date.now();
    const response = await model.getResponse(request);
    const text = response.output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content)
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    console.log(`GEMINI PRIMARY RESULT: SUCCESS (${Date.now() - started}ms) text="${text.slice(0, 60)}"`);
    if (!text) process.exitCode = 1;
  } catch (error) {
    const code = error?.code ?? "";
    console.log(`GEMINI PRIMARY RESULT: FAIL (${error?.name ?? "unknown"}${code ? `:${code}` : ""})`);
    process.exitCode = 1;
  }
});
