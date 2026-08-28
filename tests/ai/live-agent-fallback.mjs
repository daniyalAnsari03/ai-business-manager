/**
 * Live reproduction of the REAL /api/ai/chat runtime path (Prompt 13).
 *
 * Mirrors app/api/ai/chat/route.ts exactly:
 *   createBusinessManagerAgent(context) → run(agent, input, { stream: true })
 *   → FailoverModel → gemini-router (all slots forced unavailable) → Groq.
 *
 * Gemini keys are invalidated IN THIS PROCESS ONLY so every slot fails
 * authentication; `.env.local` is never modified. The message is a harmless
 * greeting ("salam") that must not touch business data or execute any tool.
 *
 * Run: node --env-file=.env.local --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/live-agent-fallback.mjs
 */

for (let slot = 1; slot <= 8; slot += 1) {
  // Process-local forced failure for EVERY Gemini slot.
  process.env[`GEMINI_API_KEY_${slot}`] = "invalid-forced-failover-check";
}

const { withTrace, run, user: userMessage } = await import("@openai/agents");
const { createBusinessManagerAgent, BUSINESS_MANAGER_MAX_TURNS } = await import(
  "../../lib/ai/agent.ts"
);

/** Same context shape the chat route builds from the session's business. */
const context = {
  businessId: "00000000-0000-0000-0000-000000000000",
  businessName: "Diagnostics Shop",
  businessType: "retail",
  currencyCode: "PKR",
  currencySymbol: "Rs",
  language: /** @type {const} */ ("ur"),
};

function classify(error) {
  let current = error;
  let depth = 0;
  while (current instanceof Error && depth < 8) {
    const name = current?.name ?? "";
    if (name === "GeminiRouterError" || name === "GroqProviderError") {
      return `${name}:${current.code}`;
    }
    current = current.cause;
    depth += 1;
  }
  return `unclassified:${error?.name ?? typeof error}`;
}

await withTrace("live-agent-fallback", async () => {
  const agent = createBusinessManagerAgent(context);
  const input = [userMessage("salam")];

  try {
    const result = await run(agent, input, {
      stream: true,
      context,
      maxTurns: BUSINESS_MANAGER_MAX_TURNS,
    });

    let sawToolCall = false;
    for await (const event of result) {
      if (event.type === "run_item_stream_event" && event.name === "tool_called") {
        sawToolCall = true;
        console.log(`UNEXPECTED TOOL CALL: ${event.item?.rawItem?.name ?? "?"}`);
      }
    }

    const finalText = (result.finalOutput ?? "").toString().trim();
    console.log(`TOOL CALLED: ${sawToolCall}`);
    console.log(`FINAL TEXT (${finalText.length} chars): "${finalText.slice(0, 200)}"`);
    console.log(finalText ? "RESULT: SUCCESS" : "RESULT: FAIL (empty final output)");
  } catch (error) {
    console.log(`RUN FAILED`);
    console.log(`CLASSIFICATION: ${classify(error)}`);
    console.log(`ERROR NAME: ${error?.name ?? "?"}`);
    console.log(
      `DETAIL: ${String(error?.message ?? error)
        .replace(/gsk_[A-Za-z0-9]+/g, "[redacted]")
        .slice(0, 400)}`,
    );
    if (error instanceof Error && error.stack) {
      console.log(`STACK HEAD: ${error.stack.split("\n").slice(0, 6).join(" | ")}`);
    }
    process.exitCode = 1;
  }
});
