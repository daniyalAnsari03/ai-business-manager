/**
 * Offline checks for the Gemini thought-signature carry layer
 * (lib/ai/gemini-thought-signatures.ts) against a stubbed transport.
 *
 * Run: node --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/thought-signature-carry.mjs
 */

process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://stub.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "stub-anon-key";

const { withGeminiThoughtSignatureCarry, hasStoredThoughtSignature } =
  await import("../../lib/ai/gemini-thought-signatures.ts");
const { resetGeminiThoughtSignaturesForTests } = await import(
  "../../lib/ai/gemini-thought-signatures.ts"
);

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const SIG = "CvcQAdHtim_live_captured_signature_placeholder_0ClPFkYA==";
const TOOL_CALL_ID = "call-carry-1";

function sseResponse(frames) {
  const text = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") +
    "data: [DONE]\n\n";
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function jsonToolCallResponse() {
  return Response.json(
    {
      id: "chatcmpl-x",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-json-9",
                type: "function",
                function: { name: "probe_clock", arguments: "{}" },
                extra_content: { google: { thought_signature: SIG + "-json" } },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
    { status: 200 },
  );
}

resetGeminiThoughtSignaturesForTests();

/* --- T1: signature captured from streamed SSE deltas -------------------- */
{
  let sawRequest = null;
  const wrapped = withGeminiThoughtSignatureCarry(async (_url, init = {}) => {
    sawRequest = init;
    return sseResponse([
      {
        id: "c1",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: TOOL_CALL_ID,
                  type: "function",
                  function: { name: "probe_clock", arguments: "{}" },
                  extra_content: { google: { thought_signature: SIG } },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "c1",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      },
    ]);
  });

  const turn1Body = JSON.stringify({
    model: "m",
    messages: [{ role: "user", content: "call probe" }],
  });
  const res = await wrapped("https://gemini.example/chat/completions", {
    method: "POST",
    body: turn1Body,
  });
  await res.text(); // consume the stream so the tap sees every frame

  record(
    "T1: thought_signature stored after streaming the tool-call response",
    hasStoredThoughtSignature(TOOL_CALL_ID),
    `id=${TOOL_CALL_ID}`,
  );
  record(
    "T1b: untouched request body passes through byte-identical (same string)",
    sawRequest?.body === turn1Body,
  );
}

/* --- T2: signature re-injected into replayed assistant history ---------- */
{
  let capturedOutbound = null;
  const wrapped = withGeminiThoughtSignatureCarry(async (_url, init = {}) => {
    capturedOutbound = init.body;
    return Response.json({ choices: [{ index: 0, delta: {} }] }, { status: 200 });
  });

  await wrapped("https://gemini.example/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: "m",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "call probe" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: TOOL_CALL_ID,
              type: "function",
              function: { name: "probe_clock", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: TOOL_CALL_ID, content: "{}" },
      ],
    }),
  });

  const outbound = JSON.parse(capturedOutbound);
  const replayed = outbound.messages[2].tool_calls[0];
  const sig =
    replayed.extra_content?.google?.thought_signature === SIG &&
    replayed.function?.name === "probe_clock";
  record(
    "T2: replayed assistant tool_call carries the captured signature",
    sig,
    JSON.stringify(replayed),
  );
}

/* --- T3: existing extra_content is never overwritten --------------------- */
{
  let capturedOutbound = null;
  const wrapped = withGeminiThoughtSignatureCarry(async (_url, init = {}) => {
    capturedOutbound = init.body;
    return Response.json({ choices: [] }, { status: 200 });
  });
  const ORIGINAL = "original-not-ours";
  await wrapped("https://gemini.example/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: "m",
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              id: TOOL_CALL_ID,
              type: "function",
              function: { name: "x", arguments: "{}" },
              extra_content: { google: { thought_signature: ORIGINAL } },
            },
          ],
        },
      ],
    }),
  });
  const outbound = JSON.parse(capturedOutbound);
  record(
    "T3: pre-existing signatures are preserved untouched",
    outbound.messages[0].tool_calls[0].extra_content.google.thought_signature ===
      ORIGINAL,
  );
}

/* --- T4: non-streaming JSON bodies are captured too ---------------------- */
{
  resetGeminiThoughtSignaturesForTests();
  const wrapped = withGeminiThoughtSignatureCarry(async () => jsonToolCallResponse());
  const res = await wrapped("https://gemini.example/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "x" }] }),
  });
  await res.text();
  record(
    "T4: signature captured from a non-streaming JSON completion",
    hasStoredThoughtSignature("call-json-9"),
  );
}

/* --- T5: bounded store survives eviction pressure ------------------------ */
{
  resetGeminiThoughtSignaturesForTests();
  let n = 0;
  const wrapped = withGeminiThoughtSignatureCarry(async () =>
    sseResponse([
      {
        id: `bulk-${(n += 1)}`,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: `call-bulk-${n}`,
                  type: "function",
                  function: { name: "t", arguments: "{}" },
                  extra_content: { google: { thought_signature: `sig-${n}` } },
                },
              ],
            },
          },
        ],
      },
    ]),
  );
  for (let i = 0; i < 1100; i += 1) {
    const r = await wrapped("https://gemini.example/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "m", messages: [] }),
    });
    await r.text();
  }
  record(
    "T5: store stays bounded and functional after >MAX insertions",
    hasStoredThoughtSignature("call-bulk-1100") &&
      !hasStoredThoughtSignature("call-bulk-1"),
    `oldest evicted=${!hasStoredThoughtSignature("call-bulk-1")} newest kept=${hasStoredThoughtSignature("call-bulk-1100")}`,
  );
}

/* --- T6: malformed upstream lines never break the stream ------------------ */
{
  resetGeminiThoughtSignaturesForTests();
  const wrapped = withGeminiThoughtSignatureCarry(async () =>
    new Response('data: {broken json\n\ndata: {"choices":"not-array"}\n\nhello', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
  );
  const res = await wrapped("https://gemini.example/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "m", messages: [] }),
  });
  const text = await res.text();
  record(
    "T6: malformed frames pass through without throwing",
    text.includes("{broken json") && text.includes("hello"),
  );
}

/* --- T7: error responses bypass tapping entirely -------------------------- */
{
  resetGeminiThoughtSignaturesForTests();
  const errBody = JSON.stringify({
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: "call-on-error",
              type: "function",
              function: { name: "t", arguments: "{}" },
              extra_content: { google: { thought_signature: "should-not-store" } },
            },
          ],
        },
      },
    ],
  });
  const wrapped = withGeminiThoughtSignatureCarry(async () =>
    new Response(errBody, { status: 400, headers: { "content-type": "application/json" } }),
  );
  const res = await wrapped("https://gemini.example/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "m", messages: [] }),
  });
  await res.text();
  record(
    "T7: 4xx error bodies are not scanned or mutated",
    !hasStoredThoughtSignature("call-on-error"),
  );
}

const failed = results.filter((r) => !r.passed);
console.log(`\n===== SUMMARY =====`);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
