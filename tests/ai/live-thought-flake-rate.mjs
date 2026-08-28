/**
 * Measures how consistently Gemini rejects a replayed tool-call turn when the
 * thought_signature is missing vs present (docs/check.txt Step 2 evidence).
 *
 * Run: node --env-file=.env.local tests/ai/live-thought-flake-rate.mjs [trials] [slot]
 */

import process from "node:process";

const TRIALS = Number(process.argv[2] ?? 8);
const SLOT = Number(process.argv[3] ?? 4);
const KEY = process.env[`GEMINI_API_KEY_${SLOT}`];
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

async function call(messages) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, max_tokens: 512 }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}

const results = { missing_400: 0, missing_200: 0, signed_400: 0, signed_200: 0, turn1_fail: 0 };

for (let i = 1; i <= TRIALS; i++) {
  const t1 = await call([{ role: "user", content: `You MUST call probe_clock now. (${i})` }]);
  const tc = t1.json?.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) {
    results.turn1_fail += 1;
    console.log(`trial ${i}: turn1 status=${t1.status} NO_TOOL_CALL`);
    continue;
  }
  const toolMsg = {
    role: "tool",
    tool_call_id: tc.id,
    content: JSON.stringify({ status: "ok", tick: i }),
  };
  const followUp = { role: "user", content: "Now report the tick value." };

  const bare = await call([
    { role: "user", content: `You MUST call probe_clock now. (${i})` },
    { role: "assistant", content: t1.json.choices[0].message.content ?? "", tool_calls: [{ id: tc.id, type: "function", function: tc.function }] },
    toolMsg,
    followUp,
  ]);
  const signed = await call([
    { role: "user", content: `You MUST call probe_clock now. (${i})` },
    { role: "assistant", content: t1.json.choices[0].message.content ?? "", tool_calls: [{ id: tc.id, type: "function", function: tc.function, extra_content: tc.extra_content }] },
    toolMsg,
    followUp,
  ]);
  if (bare.status === 400) results.missing_400 += 1; else results.missing_200 += 1;
  if (signed.status === 400) results.signed_400 += 1; else results.signed_200 += 1;
  console.log(
    `trial ${i}: sig=${tc.extra_content ? "present" : "ABSENT"} replay-missing=${bare.status} replay-signed=${signed.status}`,
  );
}

console.log("\nSUMMARY:", JSON.stringify(results));
