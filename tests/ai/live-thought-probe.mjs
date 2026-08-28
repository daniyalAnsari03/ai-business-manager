/**
 * LIVE probe: verify the thought_signature round-trip hypothesis.
 *
 * 1. Turn 1 forces a tool call; inspect whether extra_content.google.
 *    thought_signature arrives (non-streaming AND streaming).
 * 2. Replay the tool-call turn WITHOUT the signature -> expect 400.
 * 3. Replay WITH the signature -> expect 200.
 *
 * Run: node --env-file=.env.local tests/ai/live-thought-probe.mjs [slot]
 */

import process from "node:process";

const SLOT = Number(process.argv[2] ?? 4);
const KEY = process.env[`GEMINI_API_KEY_${SLOT}`];
if (!KEY) {
  console.error(`GEMINI_API_KEY_${SLOT} missing`);
  process.exit(2);
}
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "probe_clock",
      description: "Returns a test counter value.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

async function call(messages, stream) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: TOOLS,
      max_tokens: 512,
      stream,
    }),
  });
  if (!stream) {
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json };
  }
  // Streaming: reconstruct full SSE transcript + assembled tool_calls.
  const raw = await res.text();
  const toolCalls = {};
  let content = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;
    let chunk;
    try { chunk = JSON.parse(payload); } catch { continue; }
    const delta = chunk.choices?.[0]?.delta ?? {};
    content += delta.content ?? "";
    for (const tc of delta.tool_calls ?? []) {
      const idx = tc.index ?? 0;
      toolCalls[idx] = {
        ...(toolCalls[idx] ?? {}),
        ...tc,
        extra_content: tc.extra_content ?? toolCalls[idx]?.extra_content,
        function: {
          ...(toolCalls[idx]?.function ?? {}),
          ...(tc.function ?? {}),
        },
      };
    }
  }
  return { status: res.status, raw, toolCalls: Object.values(toolCalls), content };
}

function describeSig(tc) {
  const sig = tc?.extra_content?.google?.thought_signature;
  return sig ? `<present len=${sig.length} prefix=${sig.slice(0, 8)}…>` : "<ABSENT>";
}

/* --- Turn 1: force a tool call ----------------------------------------- */
console.log("=== TURN 1 (streaming, like production) ===");
const t1 = await call(
  [{ role: "user", content: "You MUST call probe_clock now." }],
  true,
);
console.log("status:", t1.status);
for (const tc of t1.toolCalls) {
  console.log(`tool_call id=${tc.id} name=${tc.function?.name} sig=${describeSig(tc)}`);
}

const toolCalls = t1.toolCalls.map((tc) => ({
  id: tc.id,
  type: "function",
  function: tc.function,
}));
if (toolCalls.length === 0) {
  console.error("No tool call received; cannot continue probe.");
  process.exit(1);
}

const assistantMsg = { role: "assistant", tool_calls: toolCalls };
const toolMsg = {
  role: "tool",
  tool_call_id: toolCalls[0].id,
  content: JSON.stringify({ status: "ok", tick: 1 }),
};
const baseMessages = [
  { role: "user", content: "You MUST call probe_clock now." },
  assistantMsg,
  toolMsg,
];
const followUp = { role: "user", content: "Now report the tick value." };

/* --- Turn 2 WITHOUT signature (reproduces production 400) --------------- */
console.log("\n=== TURN 2a: replay WITHOUT thought_signature ===");
const t2a = await call([...baseMessages, followUp], false);
console.log("status:", t2a.status);
console.log("body:", JSON.stringify(t2a.json?.error?.message ?? t2a.json).slice(0, 300));

/* --- Turn 2 WITH signature restored ------------------------------------- */
console.log("\n=== TURN 2b: replay WITH thought_signature restored ===");
const signedToolCalls = t1.toolCalls.map((tc) => ({
  id: tc.id,
  type: "function",
  function: tc.function,
  extra_content: tc.extra_content,
}));
const t2b = await call(
  [
    baseMessages[0],
    { role: "assistant", tool_calls: signedToolCalls },
    toolMsg,
    followUp,
  ],
  false,
);
console.log("status:", t2b.status);
console.log(
  "content:",
  String(t2b.json?.choices?.[0]?.message?.content ?? "").slice(0, 160),
);

/* --- Turn 1 NON-streaming: does extra_content appear there too? --------- */
console.log("\n=== TURN 1 (non-streaming) ===");
const t1n = await call(
  [{ role: "user", content: "You MUST call probe_clock now." }],
  false,
);
console.log("status:", t1n.status);
const ntc = t1n.json?.choices?.[0]?.message?.tool_calls ?? [];
for (const tc of ntc) {
  console.log(`tool_call id=${tc.id} name=${tc.function?.name} sig=${describeSig(tc)}`);
}
