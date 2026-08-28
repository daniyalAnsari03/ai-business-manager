/**
 * Captures the exact ModelRequest.tools the Agents SDK runner passes to the
 * model layer, to locate where `properties:{}` disappears. Offline only.
 */

process.env.GEMINI_API_KEY_1 = "k";
process.env.GROQ_API_KEY = "grq-dummy";

const { Agent, run, user: userMessage } = await import("@openai/agents");
const { businessTools } = await import("../../lib/ai/tools/index.ts");

let capturedTools = null;
const recordingModel = {
  async getResponse(request) {
    capturedTools = request.tools;
    throw new Error("recording-stop");
  },
  async *getStreamedResponse(request) {
    capturedTools = request.tools;
    throw new Error("recording-stop");
  },
};

const agent = new Agent({
  name: "Recorder",
  instructions: "test",
  model: /** @type {any} */ (recordingModel),
  tools: [...businessTools],
});

try {
  const result = await run(agent, [userMessage("salam")], { stream: true });
  for await (const _ev of result) void _ev;
} catch (error) {
  console.log(`run threw: ${error?.name}: ${String(error?.message).slice(0, 200)}`);
}

if (!capturedTools) {
  console.log("NO REQUEST CAPTURED");
  process.exit(1);
}

const lowStock = capturedTools.find((t) => t.name === "low_stock_products");
console.log(`captured tools: ${capturedTools.length}`);
console.log("RUNNER-PASSED low_stock_products.parameters:");
console.log(JSON.stringify(lowStock?.parameters, null, 2));
console.log(`strict flag on tool: ${lowStock?.strict}`);

const bad = capturedTools.filter(
  (t) =>
    t.type === "function" &&
    t.parameters &&
    typeof t.parameters === "object" &&
    !("properties" in t.parameters),
);
console.log(`\ntools WITHOUT properties after runner: ${bad.length}`);
for (const t of bad) console.log(` - ${t.name}: ${JSON.stringify(t.parameters)}`);
