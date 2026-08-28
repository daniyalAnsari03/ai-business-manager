/**
 * Replays the CAPTURED Agents-SDK turn-2 body against the REAL Gemini
 * endpoint, twice:
 *   A) exactly as the SDK sends it (no thought_signature)  -> expect 400
 *   B) with extra_content.google.thought_signature injected -> expect 200
 *
 * Run: node --env-file=.env.local tests/ai/live-replay-sdk-turn2.mjs [slot]
 */

import process from "node:process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SLOT = Number(process.argv[2] ?? 6);
const KEY = process.env[`GEMINI_API_KEY_${SLOT}`];
if (!KEY) {
  console.error(`GEMINI_API_KEY_${SLOT} missing`);
  process.exit(2);
}

const body = JSON.parse(
  readFileSync(join(process.cwd(), ".thought-capture", "turn2-body.json"), "utf8"),
);
// Use a REAL signature captured from a live tool call (see below) — start by
// obtaining one fresh so validation has every chance to pass.
async function fetchFreshSignature() {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: body.model,
        messages: [{ role: "user", content: "You MUST call probe_clock now." }],
        tools: body.tools,
        max_tokens: 512,
        stream: true,
      }),
    },
  );
  const raw = await res.text();
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const chunk = JSON.parse(line.slice(6));
      const tc = chunk.choices?.[0]?.delta?.tool_calls?.[0];
      if (tc?.extra_content?.google?.thought_signature) {
        return { id: tc.id, sig: tc.extra_content.google.thought_signature };
      }
    } catch {}
  }
  return null;
}

async function post(payload, label) {
  const started = Date.now();
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const text = await res.text();
  let firstContent = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const chunk = JSON.parse(line.slice(6));
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) firstContent += delta.content;
    } catch {}
  }
  console.log(
    `${label}: HTTP ${res.status} (${Date.now() - started}ms) ${
      res.status !== 200
        ? "body=" + text.slice(0, 260).replace(/\s+/g, " ")
        : "content=" + JSON.stringify(firstContent.slice(0, 120))
    }`,
  );
  return res.status;
}

console.log("=== A) SDK body verbatim (no thought_signature), stream=true ===");
await post(body, "A");

const fresh = await fetchFreshSignature();
if (!fresh) {
  console.log("could not obtain a fresh signature; skipping part B");
  process.exit(0);
}
console.log(`\nfresh signature obtained: id=${fresh.id} len=${fresh.sig.length}`);

console.log("\n=== B) same body + extra_content.google.thought_signature injected ===");
const patched = structuredClone(body);
patched.messages[2].tool_calls[0].extra_content = {
  google: { thought_signature: fresh.sig },
};
await post(patched, "B");
