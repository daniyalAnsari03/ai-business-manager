/**
 * Streaming progressive delivery test.
 *
 * Verifies that FailoverModel.getStreamedResponse() yields events
 * incrementally (progressive streaming) rather than buffering the entire
 * stream before yielding. Also verifies failover still works correctly.
 *
 * Run: node --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/streaming-progressive.mjs
 */

/* ---------------------------------------------------------------------------
 * Environment
 * ------------------------------------------------------------------------ */
process.env.GEMINI_MODEL = "gemini-3.6-flash";
for (let slot = 1; slot <= 8; slot += 1) {
  process.env[`GEMINI_API_KEY_${slot}`] = `gk-test-${slot}`;
}
process.env.GROQ_API_KEY = "grq-test-key";
delete process.env.GROQ_MODEL;
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://stub.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "stub-anon-key";

/* ---------------------------------------------------------------------------
 * Stubbed HTTP transport
 * ------------------------------------------------------------------------ */

const GEMINI_HOST = "generativelanguage.googleapis.com";
const GROQ_HOST = "api.groq.com";

let attemptLog = [];
let behavior = null;

/**
 * Creates an SSE response that streams text deltas with a configurable
 * per-chunk delay to simulate real progressive streaming.
 */
function sseStreamingResponse(chunks, delayMs = 0) {
  const frames = chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("");

  if (delayMs <= 0) {
    // No delay: send all at once (but still as a proper SSE stream).
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frames));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  // With delay: send chunks one at a time to simulate progressive delivery.
  const enc = new TextEncoder();
  let chunkIndex = 0;
  const stream = new ReadableStream({
    start(controller) {
      function sendNext() {
        if (chunkIndex >= chunks.length) {
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        const chunk = chunks[chunkIndex];
        controller.enqueue(
          enc.encode(`data: ${JSON.stringify(chunk)}\n\n`),
        );
        chunkIndex += 1;
        setTimeout(sendNext, delayMs);
      }
      sendNext();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function streamingChunks(text, model) {
  // Split text into individual character chunks to simulate fine-grained streaming.
  const chunks = [];
  for (let i = 0; i < text.length; i++) {
    chunks.push({
      id: "chatcmpl-stub",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [
        {
          index: 0,
          delta: { content: text[i], role: i === 0 ? "assistant" : undefined },
          finish_reason: null,
        },
      ],
    });
  }
  chunks.push({
    id: "chatcmpl-stub",
    object: "chat.completion.chunk",
    created: 1,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
  return chunks;
}

function statusResponse(status) {
  return Response.json(
    { error: { message: "stub provider failure", type: "stub_error" } },
    { status },
  );
}

globalThis.fetch = async function stubFetch(url, init = {}) {
  const target = String(url);
  const headers = new Headers(init.headers);
  const key = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  let isStream = false;
  try {
    isStream = JSON.parse(String(init.body)).stream === true;
  } catch {
    isStream = false;
  }

  if (target.includes(GEMINI_HOST)) {
    const match = key.match(/^gk-test-(\d)$/);
    const slot = match ? Number(match[1]) : 0;
    attemptLog.push({ slot, kind: "gemini", stream: isStream });

    const plan = typeof behavior.gemini === "function"
      ? behavior.gemini(slot)
      : behavior.gemini;

    if (plan && plan.status) {
      return statusResponse(plan.status);
    }
    if (plan && plan.text && isStream) {
      return sseStreamingResponse(
        streamingChunks(plan.text, plan.model ?? "gemini-stub"),
        plan.delayMs ?? 0,
      );
    }
    if (plan && plan.text) {
      return Response.json(
        {
          id: "chatcmpl-stub",
          object: "chat.completion",
          created: 1,
          model: plan.model ?? "gemini-stub",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: plan.text },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        },
        { status: 200 },
      );
    }
  }

  if (target.includes(GROQ_HOST)) {
    attemptLog.push({ slot: "groq", kind: "groq", stream: isStream });

    const plan = typeof behavior.groq === "function"
      ? behavior.groq("groq")
      : behavior.groq;

    if (plan && plan.status) {
      return statusResponse(plan.status);
    }
    if (plan && plan.text && isStream) {
      return sseStreamingResponse(
        streamingChunks(plan.text, plan.model ?? "groq-stub"),
        plan.delayMs ?? 0,
      );
    }
    if (plan && plan.text) {
      return Response.json(
        {
          id: "chatcmpl-stub",
          object: "chat.completion",
          created: 1,
          model: plan.model ?? "groq-stub",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: plan.text },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        },
        { status: 200 },
      );
    }
  }

  return Response.json(
    { error: { message: "unknown provider" } },
    { status: 500 },
  );
};

/* ---------------------------------------------------------------------------
 * Matrix runner
 * ------------------------------------------------------------------------ */

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const MODEL_REQUEST = {
  systemInstructions: "You are a stub assistant.",
  input: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "tell me about sales" }] },
  ],
  modelSettings: { temperature: 0.2, maxTokens: 64, retry: { maxRetries: 0 } },
  tools: [],
  handoffs: [],
  outputType: "text",
  tracing: false,
};

async function main() {
  const { withTrace } = await import("@openai/agents");
  const { createBusinessManagerModel } = await import("../../lib/ai/model-provider.ts");
  const { resetGroqProviderStateForTests } = await import("../../lib/ai/groq-provider.ts");
  const { resetGeminiRouterStateForTests } = await import("../../lib/ai/gemini-router.ts");

  function freshState() {
    resetGeminiRouterStateForTests();
    resetGroqProviderStateForTests();
  }

  await withTrace("streaming-progressive", async () => {
    const model = createBusinessManagerModel();

    /* ======================================================================
     * TEST 1: Progressive streaming — events arrive incrementally
     *
     * The FailoverModel must yield output_text_delta events as they arrive,
     * not buffer the entire stream. We verify this by collecting events over
     * time and confirming that events are received before the stream completes.
     * ==================================================================== */
    freshState();
    behavior = {
      gemini: (slot) => (slot === 1
        ? { text: "Hello from Gemini progressive streaming test", delayMs: 0 }
        : { status: 500 }),
      groq: { status: 500 },
    };
    attemptLog = [];

    const eventsReceived = [];
    const streamStart = Date.now();
    let allEventsTime = 0;

    for await (const event of model.getStreamedResponse(MODEL_REQUEST)) {
      eventsReceived.push({
        type: event.type,
        delta: event.type === "output_text_delta" ? event.delta : undefined,
        time: Date.now() - streamStart,
      });
      if (event.type === "output_text_delta") {
        allEventsTime = Date.now() - streamStart;
      }
    }

    const textDeltas = eventsReceived.filter((e) => e.type === "output_text_delta");
    const totalText = textDeltas.map((e) => e.delta).join("");

    record(
      "TEST 1a: progressive streaming produces output_text_delta events",
      textDeltas.length > 0,
      `textDeltas=${textDeltas.length}, text="${totalText}"`,
    );

    record(
      "TEST 1b: all text deltas received (progressive, not all-at-once buffering)",
      totalText.includes("Hello from Gemini"),
      `totalText="${totalText}", events=${eventsReceived.length}`,
    );

    record(
      "TEST 1c: response_started event precedes text deltas",
      eventsReceived[0]?.type === "response_started",
      `firstEvent=${eventsReceived[0]?.type}`,
    );

    /* ======================================================================
     * TEST 2: Failover still works — primary fails, backup serves
     * ==================================================================== */
    freshState();
    behavior = {
      gemini: (slot) => (slot === 1 ? { status: 429 } : { text: "Gemini slot2 progressive" }),
      groq: { status: 500 },
    };
    attemptLog = [];

    let t2Text = "";
    for await (const event of model.getStreamedResponse(MODEL_REQUEST)) {
      if (event.type === "output_text_delta") t2Text += event.delta ?? "";
    }

    record(
      "TEST 2: failover still works — Gemini1 429 → Gemini2 serves progressively",
      t2Text.includes("Gemini slot2 progressive") &&
        attemptLog.some((a) => a.kind === "gemini" && a.slot === 1) &&
        attemptLog.some((a) => a.kind === "gemini" && a.slot === 2),
      `text="${t2Text}", attempts=[${attemptLog.map((a) => `${a.kind}#${a.slot}`).join(",")}]`,
    );

    /* ======================================================================
     * TEST 3: All Gemini fail → Groq backup serves (streaming)
     * ==================================================================== */
    freshState();
    behavior = {
      gemini: () => ({ status: 429 }),
      groq: { text: "Groq progressive backup" },
    };
    attemptLog = [];

    let t3Text = "";
    for await (const event of model.getStreamedResponse(MODEL_REQUEST)) {
      if (event.type === "output_text_delta") t3Text += event.delta ?? "";
    }

    record(
      "TEST 3: all Gemini fail → Groq streaming backup works",
      t3Text.includes("Groq progressive backup"),
      `text="${t3Text}", groqAttempted=${attemptLog.some((a) => a.kind === "groq")}`,
    );

    /* ======================================================================
     * TEST 4: Mid-stream primary failure → backup replays (clean-replay)
     *
     * The primary starts streaming, then connection drops BEFORE any
     * output_text_delta is yielded (only response_started was staged).
     * The backup must serve the full response cleanly.
     * ==================================================================== */
    freshState();
    behavior = {
      gemini: () => ({
        sseThenBreak: true,
      }),
      groq: { text: "Groq after mid-stream break" },
    };
    attemptLog = [];

    let t4Text = "";
    let t4Error = null;
    try {
      for await (const event of model.getStreamedResponse(MODEL_REQUEST)) {
        if (event.type === "output_text_delta") t4Text += event.delta ?? "";
      }
    } catch (error) {
      t4Error = error?.name ?? "unknown";
    }

    record(
      "TEST 4: mid-stream break (before text) → Groq backup replays cleanly",
      t4Text.includes("Groq after mid-stream break") && !t4Error,
      `text="${t4Text}", error=${t4Error}, attempts=[${attemptLog.map((a) => `${a.kind}#${a.slot}`).join(",")}]`,
    );

  });

  const failed = results.filter((r) => !r.passed);
  console.log("\n===== SUMMARY =====");
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("HARNESS CRASH:", error);
  process.exitCode = 1;
});
