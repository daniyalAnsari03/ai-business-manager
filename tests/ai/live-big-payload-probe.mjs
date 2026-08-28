/**
 * Live probe: REAL production request shape (real system instructions + all
 * real business tool schemas + accumulated history) against the REAL
 * providers. Measures serialized payload size and outcome, to expose
 * provider-side limits that small stub probes never hit.
 *
 * Run: node --env-file=.env.local --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/live-big-payload-probe.mjs
 */

process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://stub.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "stub-anon-key";

const { withTrace } = await import("@openai/agents");
const { createBusinessManagerModel } = await import("../../lib/ai/model-provider.ts");
const { getGeminiProviders } = await import("../../lib/ai/gemini-config.ts");
const { businessTools } = await import("../../lib/ai/tools/index.ts");
const { buildBusinessManagerInstructions } = await import("../../lib/ai/agent.ts");

await withTrace("live-big-payload", async () => {
  const providers = getGeminiProviders();
  const healthyKey = providers.find((p) => p.slot === 2)?.apiKey ?? providers[0]?.apiKey;
  if (!healthyKey) {
    console.log("no gemini key configured");
    return;
  }

  const context = {
    businessId: "probe-business",
    businessName: "Probe Store",
    businessType: "retail",
    currencyCode: "PKR",
    currencySymbol: "Rs",
    language: "ur",
  };

  const instructions = buildBusinessManagerInstructions(context);
  const serializedTools = businessTools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.parameters,
    strict: tool.strict === true,
  }));

  // Approximate the wire payload size the way chat-completions sends it.
  const approxBody = JSON.stringify({
    model: "x",
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: "Mere products ka stock batao" },
    ],
    tools: serializedTools,
  });
  console.log(`instructions chars=${instructions.length}`);
  console.log(`tools count=${serializedTools.length}`);
  console.log(`approx wire body bytes=${Buffer.byteLength(approxBody)}`);

  const request = {
    systemInstructions: instructions,
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Sab products ki list batao" }],
      },
    ],
    modelSettings: { temperature: 0.3, maxTokens: 1200 },
    tools: /** @type {any} */ (serializedTools),
    handoffs: [],
    outputType: "text",
    tracing: false,
  };

  /* ---- Direct Groq backup-model attempt with the FULL real payload ----- */
  const { getGroqBackupModel } = await import("../../lib/ai/groq-provider.ts");
  const groq = getGroqBackupModel();
  if (groq) {
    const started = Date.now();
    try {
      const response = await groq.getResponse(request);
      const text = response.output
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content)
        .map((part) => part.text ?? "")
        .join("");
      console.log(
        `GROQ full-payload: SUCCESS (${Date.now() - started}ms) contentLen=${text.length} ` +
          `finishInfo=ok preview="${text.slice(0, 70)}"`,
      );
    } catch (error) {
      console.log(
        `GROQ full-payload: FAIL (${Date.now() - started}ms) ${error?.name ?? "?"}: ${
          String(error?.message ?? error).slice(0, 200)
        } status=${error?.status ?? "-"}`,
      );
    }
  }

  /* ---- Same payload through the primary Gemini chain ------------------- */
  const model = createBusinessManagerModel();
  const started = Date.now();
  try {
    const response = await model.getResponse(request);
    const text = response.output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content)
      .map((part) => part.text ?? "")
      .join("");
    console.log(
      `GEMINI-chain full-payload: SUCCESS (${Date.now() - started}ms) contentLen=${text.length}`,
    );
  } catch (error) {
    console.log(
      `GEMINI-chain full-payload: FAIL (${Date.now() - started}ms) ${error?.name ?? "?"}: ${
        String(error?.message ?? error).slice(0, 200)
      }`,
    );
  }
});
