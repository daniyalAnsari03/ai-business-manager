/**
 * Captures the RAW upstream Groq error for the REAL production request.
 *
 * Same forced-Gemini-failure setup as live-agent-fallback.mjs, plus a
 * transparent fetch tap around api.groq.com: forwards the untouched request,
 * records status + sanitized error body, returns the original response.
 * Never prints credentials.
 *
 * Run: node --env-file=.env.local --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/groq-error-probe.mjs
 */

for (let slot = 1; slot <= 8; slot += 1) {
  process.env[`GEMINI_API_KEY_${slot}`] = "invalid-forced-failover-check";
}

const realFetch = globalThis.fetch;
let captured = null;

globalThis.fetch = async function tappedFetch(url, init = {}) {
  const target = String(url);
  const isGroq = target.includes("api.groq.com");
  const started = Date.now();
  const response = await realFetch(url, init);
  if (isGroq && !response.ok && !captured) {
    const body = await response.clone().text();
    // Log the REQUEST BODY shape (tools/payload) so we can see exactly what
    // Groq rejected — redact anything credential-like first.
    let requestBody = null;
    try {
      requestBody = JSON.parse(String(init.body ?? "null"));
    } catch {}
    captured = {
      status: response.status,
      url: target.replace(/https:\/\/api\.groq\.com/, "https://api.groq.com"),
      body: body.replace(/gsk_[A-Za-z0-9]+/g, "[redacted]").slice(0, 1500),
      requestShape: requestBody
        ? {
            model: requestBody.model,
            stream: requestBody.stream,
            temperature: requestBody.temperature,
            max_tokens: requestBody.max_tokens,
            max_completion_tokens: requestBody.max_completion_tokens,
            tool_choice: requestBody.tool_choice,
            parallel_tool_calls: requestBody.parallel_tool_calls,
            response_format: requestBody.response_format,
            messagesCount: Array.isArray(requestBody.messages)
              ? requestBody.messages.length
              : null,
            toolNames: Array.isArray(requestBody.tools)
              ? requestBody.tools.map((t) => t?.function?.name)
              : null,
            firstToolSchema: Array.isArray(requestBody.tools) && requestBody.tools[0]
              ? JSON.stringify(requestBody.tools[0]?.function?.parameters).slice(0, 800)
              : null,
          }
        : null,
      ms: Date.now() - started,
    };
  }
  return response;
};

const { withTrace, run, user: userMessage } = await import("@openai/agents");
const { createBusinessManagerAgent, BUSINESS_MANAGER_MAX_TURNS } = await import(
  "../../lib/ai/agent.ts"
);

const context = {
  businessId: "00000000-0000-0000-0000-000000000000",
  businessName: "Diagnostics Shop",
  businessType: "retail",
  currencyCode: "PKR",
  currencySymbol: "Rs",
  language: "ur",
};

await withTrace("groq-error-probe", async () => {
  const agent = createBusinessManagerAgent(context);
  try {
    const result = await run(agent, [userMessage("salam")], {
      stream: true,
      context,
      maxTurns: BUSINESS_MANAGER_MAX_TURNS,
    });
    for await (const _event of result) void _event;
    console.log(`RUN COMPLETED (no provider error captured): "${String(result.finalOutput ?? "").slice(0, 120)}"`);
  } catch {
    console.log("RUN FAILED (as before) — captured upstream detail below.");
  }

  if (!captured) {
    console.log("NO FAILED GROQ RESPONSE CAPTURED.");
    return;
  }
  console.log(`GROQ HTTP STATUS: ${captured.status} (${captured.ms}ms)`);
  console.log(`REQUEST SHAPE: ${JSON.stringify(captured.requestShape, null, 2)}`);
  console.log(`UPSTREAM ERROR BODY: ${captured.body}`);
});
