/**
 * Captures the EXACT HTTP bodies the Agents SDK exchange during a streamed
 * two-turn tool run (turn 1 = model emits tool call incl. Google's
 * extra_content.google.thought_signature in the SSE; turn 2 = SDK replays
 * history). Offline: transport is fully stubbed.
 *
 * Writes:
 *   %TEMP%/opencode/thought-probe-turn1-sse.txt   raw turn-1 SSE transcript
 *   %TEMP%/opencode/thought-probe-turn2-body.json turn-2 request body
 *
 * Run: node --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/capture-sdk-turn2.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
process.env.GEMINI_API_KEY_1 = "gk-test-1";
for (let slot = 2; slot <= 8; slot += 1) delete process.env[`GEMINI_API_KEY_${slot}`];
delete process.env.GROQ_API_KEY;

const OUT_DIR = join(process.cwd(), ".thought-capture");
mkdirSync(OUT_DIR, { recursive: true });

const FAKE_SIG = "CvcQAdHtim_fake_signature_for_capture_only_0ClPFkYA==";

const sseToolCallChunks = [
  {
    id: "chatcmpl-cap",
    object: "chat.completion.chunk",
    created: 1,
    model: "gemini-3.6-flash",
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          content: "",
        },
        finish_reason: null,
      },
    ],
  },
  {
    id: "chatcmpl-cap",
    object: "chat.completion.chunk",
    created: 1,
    model: "gemini-3.6-flash",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call-cap-1",
              type: "function",
              function: { name: "probe_clock", arguments: "{}" },
              extra_content: { google: { thought_signature: FAKE_SIG } },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  },
  {
    id: "chatcmpl-cap",
    object: "chat.completion.chunk",
    created: 1,
    model: "gemini-3.6-flash",
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
  },
];

let requestCount = 0;
let captured = false;

globalThis.fetch = async function stub(url, init = {}) {
  const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
  requestCount += 1;
  if (requestCount === 1) {
    // Turn 1: serve the signed tool call.
    const frames = sseToolCallChunks
      .map((c) => `data: ${JSON.stringify(c)}\n\n`)
      .join("");
    return new Response(`${frames}data: [DONE]\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }
  // Turn 2+: record and stop.
  writeFileSync(
    join(OUT_DIR, "turn2-body.json"),
    JSON.stringify(body, null, 2),
  );
  captured = true;
  throw new Error("capture-stop");
};

const { withTrace } = await import("@openai/agents");
const agents = await import("@openai/agents");
const { Agent, run, tool } = agents;
const { z } = await import("zod");
const { createBusinessManagerModel } = await import("../../lib/ai/model-provider.ts");

const probeTool = tool({
  name: "probe_clock",
  description: "Returns a test counter value.",
  parameters: z.object({}),
  execute: async () => ({ status: "ok", tick: 1 }),
});

await withTrace("capture-sdk-turn2", async () => {
  const agent = new Agent({
    name: "Capture BM",
    instructions: "Always call probe_clock once, then report.",
    model: createBusinessManagerModel(),
    tools: [probeTool],
  });
  try {
    const result = await run(agent, "call the probe tool", {
      stream: true,
      maxTurns: 3,
    });
    for await (const _ev of result) void _ev;
  } catch (error) {
    console.log(`run stopped: ${String(error?.message).slice(0, 80)}`);
  }
});

if (!captured) {
  console.log("TURN 2 NEVER CAPTURED");
  process.exit(1);
}
console.log(`captured turn-2 body -> ${join(OUT_DIR, "turn2-body.json")}`);
