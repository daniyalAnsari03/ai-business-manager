/**
 * Consecutive-request failover reproduction (docs/check.txt).
 *
 * Drives the REAL application modules (gemini-router, model-provider,
 * groq-provider wiring, Agents SDK chat-completions model) across several
 * CONSECUTIVE requests WITHOUT resetting shared provider state between
 * them — mirroring a live server process where one request's cooldowns are
 * still active when the next request arrives.
 *
 * Run: node --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/consecutive-requests.mjs
 */

/* ---------------------------------------------------------------------------
 * Environment for the app modules (dummy values — never real credentials).
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
 * Stubbed HTTP transport (same conventions as failover-matrix.mjs).
 * ------------------------------------------------------------------------ */

const GEMINI_HOST = "generativelanguage.googleapis.com";
const GROQ_HOST = "api.groq.com";

/** @type {{slot:number|string, kind:string, stream:boolean}[]} */
let attemptLog = [];
let behavior = null;
/** Raw JSON body of the most recent Groq request (reasoning-budget probe). */
let lastGroqRequestBody = null;

function jsonCompletion(text, model, extraMessage = {}) {
  return {
    id: "chatcmpl-stub",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text, ...extraMessage },
        finish_reason: extraMessage.tool_calls ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  };
}

function sseResponse(chunks) {
  const frames = chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("");
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames));
      if (chunks.length > 0) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function sseChunksFor(tag, model) {
  return [
    {
      id: "chatcmpl-stub",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [{ index: 0, delta: { role: "assistant", content: tag }, finish_reason: null }],
    },
    {
      id: "chatcmpl-stub",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
}

/** OpenAI-wire-format SSE chunks that aggregate into ONE complete tool call. */
function sseToolCallChunks(model) {
  return [
    {
      id: "chatcmpl-stub",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call-stub-g1",
                type: "function",
                function: { name: "echo_stub", arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: "chatcmpl-stub",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: '{"word":' } }] },
          finish_reason: null,
        },
      ],
    },
    {
      id: "chatcmpl-stub",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: '"hello"}' } }] },
          finish_reason: null,
        },
      ],
    },
    {
      id: "chatcmpl-stub",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    },
  ];
}

/**
 * A stream that DELIVERS its frames successfully (HTTP 200 was already sent)
 * and only THEN breaks — the exact shape of a mid-stream connection drop
 * after the router could no longer see the request.
 */
function sseThenErrorResponse(chunks) {
  const frames = chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("");
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames));
      controller.error(new Error("connection reset mid-stream"));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function statusResponse(status, message) {
  return Response.json(
    { error: { message: message ?? "stub provider failure", type: "stub_error" } },
    { status },
  );
}

function planFor(providerKey, isStream) {
  const isGroq = providerKey === "groq";
  const table = isGroq ? behavior.groq : behavior.gemini;
  const entry = typeof table === "function" ? table(isGroq ? "groq" : providerKey) : table;
  if (entry && entry.status) {
    return { respond: () => statusResponse(entry.status, entry.message) };
  }
  if (!isStream) {
    return {
      respond: () =>
        Response.json(jsonCompletion(entry.text ?? "ok", entry.model ?? "m"), { status: 200 }),
    };
  }
  if (entry.toolCall) {
    return { respond: () => sseResponse(sseToolCallChunks(entry.model ?? "m")) };
  }
  if (entry.errorMidStream) {
    return {
      respond: () =>
        sseThenErrorResponse(sseChunksFor(entry.tag ?? "dropped", entry.model ?? "m")),
    };
  }
  return { respond: () => sseResponse(sseChunksFor(entry.text ?? "x", entry.model ?? "m")) };
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
    const { respond } = planFor(slot, isStream);
    return respond();
  }
  if (target.includes(GROQ_HOST)) {
    attemptLog.push({ slot: "groq", kind: "groq", stream: isStream });
    try {
      lastGroqRequestBody = JSON.parse(String(init.body));
    } catch {
      lastGroqRequestBody = null;
    }
    const { respond } = planFor("groq", isStream);
    return respond();
  }
};

/* ---------------------------------------------------------------------------
 * Matrix runner
 * ------------------------------------------------------------------------ */

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

function attemptsSummary() {
  return attemptLog.map((a) => `${a.kind}#${a.slot}${a.stream ? ":sse" : ""}`).join(",");
}

const MODEL_REQUEST = {
  systemInstructions: "You are a stub assistant.",
  input: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "ping" }] },
  ],
  modelSettings: { temperature: 0.2, maxTokens: 64 },
  tools: [],
  handoffs: [],
  outputType: "text",
  tracing: false,
};

async function getFinalText(model, request) {
  const response = await model.getResponse(request);
  return response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .map((part) => part.text ?? "")
    .join("");
}

async function getStreamedText(model, request) {
  let text = "";
  for await (const event of model.getStreamedResponse(request)) {
    if (event.type === "output_text_delta") text += event.delta ?? "";
  }
  return text;
}

function expectErrorClassification(error) {
  // Mirrors the route's classification walk (shared cause-chain walker).
  let current = error;
  let depth = 0;
  while (current instanceof Error && depth < 16) {
    if (current?.name === "GeminiRouterError" || current?.name === "GroqProviderError") {
      return `${current.name}:${current.code}`;
    }
    current = current.cause;
    depth += 1;
  }
  return `unclassified:${String(error)}`;
}

const gemini429 = () => ({ status: 429 });

async function main() {
  const { withTrace } = await import("@openai/agents");
  const { createBusinessManagerModel } = await import("../../lib/ai/model-provider.ts");
  const { resetGeminiRouterStateForTests } = await import("../../lib/ai/gemini-router.ts");
  const { resetGroqProviderStateForTests } = await import("../../lib/ai/groq-provider.ts");

  // One reset at SESSION start only — like a freshly started server process.
  // Everything below runs CONSECUTIVELY against the same shared router state.
  resetGeminiRouterStateForTests();
  resetGroqProviderStateForTests();

  await withTrace("consecutive-requests", async () => {
    const model = createBusinessManagerModel();

    /* ======================================================================
     * SESSION A — STREAMING (production path), exact reported incident.
     * ==================================================================== */

    // Request 1: slots 1–2 exhausted (real 429s → cooldowns), slot 3 serves.
    behavior = {
      gemini: (slot) => (slot <= 2 ? { status: 429 } : { text: `slot${slot}` }),
      groq: { status: 500 },
    };
    attemptLog = [];
    const r1 = await getStreamedText(model, MODEL_REQUEST).catch((e) => `ERROR:${expectErrorClassification(e)}`);
    record(
      "REQ 1 (stream): Gemini1-2 429 → Gemini3 success",
      typeof r1 === "string" && r1.includes("slot3"),
      `text="${r1}", attempts=[${attemptsSummary()}]`,
    );

    // Request 2 — THE REPORTED BUG STEP: immediately afterward the previous
    // winner (slot 3) AND every other ready slot hit quota limits, while the
    // cooled-down slots 1–2 have RECOVERED. The router MUST keep walking the
    // chain into the cooled slots instead of returning a quota error. No
    // refresh, no reset — same process, same shared state.
    behavior = {
      gemini: (slot) =>
        slot <= 2 ? { text: `slot${slot}-recovered` } : { status: 429 },
      groq: { text: "MUST_NOT_APPEAR_REQ2" },
    };
    attemptLog = [];
    const r2 = await getStreamedText(model, MODEL_REQUEST).catch((e) => `ERROR:${expectErrorClassification(e)}`);
    record(
      "REQ 2 (stream): previous winner now 429, cooled slots recovered → success WITHOUT refresh",
      typeof r2 === "string" && r2.includes("slot1-recovered"),
      `text="${r2}", attempts=[${attemptsSummary()}]`,
    );

    // Request 3 — all 8 Gemini genuinely unavailable → Groq must answer.
    behavior = { gemini: gemini429, groq: { text: "groq-answer" } };
    attemptLog = [];
    const r3 = await getStreamedText(model, MODEL_REQUEST).catch((e) => `ERROR:${expectErrorClassification(e)}`);
    record(
      "REQ 3 (stream): all 8 Gemini 429 → Groq engaged and succeeds",
      typeof r3 === "string" && r3.includes("groq-answer"),
      `text="${r3}", attempts=[${attemptsSummary()}]`,
    );

    // Request 4 — every provider genuinely down: the ONLY allowed quota error.
    behavior = { gemini: gemini429, groq: { status: 429 } };
    attemptLog = [];
    let r4Outcome = "";
    try {
      await getStreamedText(model, MODEL_REQUEST);
      r4Outcome = "NO_ERROR (bad)";
    } catch (error) {
      r4Outcome = expectErrorClassification(error);
    }
    record(
      "REQ 4 (stream): ALL providers down → single final provider/quota error",
      r4Outcome === "GroqProviderError:rate_limited" || r4Outcome === "GeminiRouterError:rate_limited",
      `outcome=${r4Outcome}, attempts=[${attemptsSummary()}]`,
    );

    // Request 5 — recovery WITHOUT refresh: slot 5 and Groq healthy again.
    behavior = {
      gemini: (slot) => (slot === 5 ? { text: "slot5-back" } : { status: 429 }),
      groq: { text: "MUST_NOT_APPEAR_REQ5" },
    };
    attemptLog = [];
    const r5 = await getStreamedText(model, MODEL_REQUEST).catch((e) => `ERROR:${expectErrorClassification(e)}`);
    record(
      "REQ 5 (stream): full-cooldown state recovers automatically on next request",
      typeof r5 === "string" && r5.includes("slot5-back"),
      `text="${r5}", attempts=[${attemptsSummary()}]`,
    );

    /* ======================================================================
     * SESSION B — success must NOT pin or block the next request.
     * ==================================================================== */
    resetGeminiRouterStateForTests();
    resetGroqProviderStateForTests();

    // Request 1 succeeds on slot 1.
    behavior = { gemini: { text: "slotN" }, groq: { status: 500 } };
    attemptLog = [];
    const b1 = await getStreamedText(model, MODEL_REQUEST).catch((e) => `ERROR:${expectErrorClassification(e)}`);
    record(
      "SESSION B REQ 1 (stream): slot 1 healthy and serves",
      typeof b1 === "string" && b1.includes("slotN") && attemptsSummary() === "gemini#1:sse",
      `text="${b1}", attempts=[${attemptsSummary()}]`,
    );

    // Request 2 immediately after: slot 1 dies mid-session; slot 2 must serve.
    behavior = {
      gemini: (slot) => (slot === 1 ? { status: 429 } : { text: `slot${slot}` }),
      groq: { status: 500 },
    };
    attemptLog = [];
    const b2 = await getStreamedText(model, MODEL_REQUEST).catch((e) => `ERROR:${expectErrorClassification(e)}`);
    record(
      "SESSION B REQ 2 (stream): previous success does not pin/block — next slot serves",
      typeof b2 === "string" && b2.includes("slot2") && !b2.includes("quota"),
      `text="${b2}", attempts=[${attemptsSummary()}]`,
    );

    /* ======================================================================
     * SESSION C — NON-STREAMING variant of the reported incident.
     * ==================================================================== */
    resetGeminiRouterStateForTests();
    resetGroqProviderStateForTests();

    behavior = {
      gemini: (slot) => (slot <= 2 ? { status: 429 } : { text: `slot${slot}` }),
      groq: { status: 500 },
    };
    attemptLog = [];
    const c1 = await getFinalText(model, MODEL_REQUEST).catch((e) => `ERROR:${expectErrorClassification(e)}`);
    record(
      "SESSION C REQ 1 (non-stream): Gemini1-2 429 → Gemini3 success",
      typeof c1 === "string" && c1.includes("slot3"),
      `text="${c1}", attempts=[${attemptsSummary()}]`,
    );

    behavior = {
      gemini: (slot) =>
        slot <= 2 ? { text: `slot${slot}-recovered` } : { status: 429 },
      groq: { text: "MUST_NOT_APPEAR_C2" },
    };
    attemptLog = [];
    const c2 = await getFinalText(model, MODEL_REQUEST).catch((e) => `ERROR:${expectErrorClassification(e)}`);
    record(
      "SESSION C REQ 2 (non-stream): cooled slots recovered → success WITHOUT refresh",
      typeof c2 === "string" && c2.includes("slot1-recovered"),
      `text="${c2}", attempts=[${attemptsSummary()}]`,
    );

    behavior = { gemini: gemini429, groq: { text: "groq-c3" } };
    attemptLog = [];
    const c3 = await getFinalText(model, MODEL_REQUEST).catch((e) => `ERROR:${expectErrorClassification(e)}`);
    record(
      "SESSION C REQ 3 (non-stream): all 8 Gemini 429 → Groq engaged and succeeds",
      typeof c3 === "string" && c3.includes("groq-c3"),
      `text="${c3}", attempts=[${attemptsSummary()}]`,
    );

    /* ======================================================================
     * SESSION D — the REAL Agents SDK runner (exactly what route.ts uses):
     * streamed multi-turn agent runs, shared provider state across runs,
     * a tool call in the middle so each run makes SEVERAL model requests.
     * ==================================================================== */
    resetGeminiRouterStateForTests();
    resetGroqProviderStateForTests();

    const { Agent, run, tool } = await import("@openai/agents");
    const { z } = await import("zod");

    const echoTool = tool({
      name: "echo_stub",
      description: "Echoes the given word back.",
      parameters: z.object({ word: z.string() }),
      execute: async ({ word }) => ({ status: "ok", word }),
    });

    const agent = new Agent({
      name: "Stub Business Manager",
      instructions:
        "Use the echo_stub tool for every request, then report the echoed word plainly.",
      model: createBusinessManagerModel(),
      tools: [echoTool],
    });

    async function streamedRun(agentRef, text) {
      const result = await run(agentRef, text, { stream: true, maxTurns: 14 });
      // Consume the stream exactly like app/api/ai/chat/route.ts does.
      for await (const _event of result) {
        void _event;
      }
      return (result.finalOutput ?? "").toString();
    }

    // Run 1: slots 1–2 exhausted; slot 3 serves BOTH turns (tool + final).
    behavior = {
      gemini: (slot) => (slot <= 2 ? { status: 429 } : { text: "echo-ok" }),
      groq: { status: 500 },
    };
    attemptLog = [];
    const d1 = await streamedRun(agent, "say echo via tool").catch((e) => `ERROR:${expectErrorClassification(e)}`);
    record(
      "SESSION D RUN 1 (agent run): multi-turn tool run succeeds via slot 3",
      typeof d1 === "string" && d1.length > 0 && !d1.startsWith("ERROR") &&
        attemptLog.filter((a) => a.kind === "gemini").length >= 2,
      `output="${d1}", attempts=[${attemptsSummary()}]`,
    );

    // Run 2 — REPORTED INCIDENT, full agent path: every ready slot now 429s;
    // the cooled-down slots 1–2 recovered. Must continue into them and serve.
    behavior = {
      gemini: (slot) =>
        slot <= 2 ? { text: "echo-ok-recovered" } : { status: 429 },
      groq: { text: "MUST_NOT_APPEAR_D2" },
    };
    attemptLog = [];
    const d2 = await streamedRun(agent, "say echo via tool again").catch((e) => `ERROR:${expectErrorClassification(e)}`);
    record(
      "SESSION D RUN 2 (agent run): consecutive run continues into recovered cooled slots — no quota error, no refresh",
      typeof d2 === "string" && d2.length > 0 && !d2.startsWith("ERROR"),
      `output="${d2}", attempts=[${attemptsSummary()}]`,
    );

    // Run 3 — all Gemini down → real runner must land on Groq transparently.
    behavior = { gemini: gemini429, groq: { text: "groq-agent-answer" } };
    attemptLog = [];
    const d3 = await streamedRun(agent, "say echo via tool once more").catch((e) => `ERROR:${expectErrorClassification(e)}`);
    record(
      "SESSION D RUN 3 (agent run): all 8 Gemini fail → Groq serves the whole run",
      typeof d3 === "string" && d3.length > 0 && !d3.startsWith("ERROR") &&
        attemptLog.some((a) => a.kind === "groq"),
      `output="${d3}", attempts=[${attemptsSummary()}]`,
    );

    /* ======================================================================
     * SESSION E — deep error wrapping must never disable the backup or
     * misclassify the final error. If the Agents SDK wraps provider errors
     * in several layers, the chain walk must STILL find them.
     * ==================================================================== */
    const { geminiChainFailureCode } = await import("../../lib/ai/groq-provider.ts");
    const { findErrorInCauseChain, GeminiRouterError } = await import("../../lib/ai/gemini-router.ts");

    function wrapDeeply(error, layers) {
      let current = error;
      for (let i = 0; i < layers; i += 1) {
        current = new Error(`wrapper-${i}`, { cause: current });
      }
      return current;
    }

    const deepRouterError = wrapDeeply(new GeminiRouterError("rate_limited"), 12);
    const deepGroqError = wrapDeeply(
      Object.assign(new Error("groq down"), { name: "GroqProviderError", code: "rate_limited" }),
      10,
    );

    record(
      "SESSION E: GeminiRouterError buried under 12 wrapper layers still triggers Groq backup eligibility",
      geminiChainFailureCode(deepRouterError) === "rate_limited",
      `resolved=${geminiChainFailureCode(deepRouterError)}`,
    );
    record(
      "SESSION E: route classifier finds provider error buried under 10 wrapper layers",
      findErrorInCauseChain(deepGroqError, (c) => c?.name === "GroqProviderError") !== null,
    );

    // End-to-end through the REAL runner: total provider failure (all Gemini
    // + Groq failing) surfaces a classifiable provider error — exactly what
    // app/api/ai/chat/route.ts relies on to emit ONE final safe code.
    resetGeminiRouterStateForTests();
    resetGroqProviderStateForTests();
    behavior = { gemini: gemini429, groq: { status: 429 } };
    attemptLog = [];
    let e2Outcome = "";
    try {
      await streamedRun(agent, "final probe");
      e2Outcome = "NO_ERROR (bad)";
    } catch (error) {
      e2Outcome = expectErrorClassification(error);
    }
    record(
      "SESSION E: real runner + ALL providers failing → single classified quota error",
      e2Outcome === "GroqProviderError:rate_limited" || e2Outcome === "GeminiRouterError:rate_limited",
      `outcome=${e2Outcome}, attempts=[${attemptsSummary()}]`,
    );

    /* ======================================================================
     * SESSION G — POST-TOOL MID-STREAM PROVIDER FAILURE (docs/check.txt §3/§10,
     * Test H): turn 1 completes a REAL tool call through Gemini; the tool's
     * mutation "succeeds"; then turn 2 (the final-response turn) starts
     * streaming on Gemini and the connection DIES MID-STREAM — an error the
     * router can no longer see because HTTP 200 was already returned.
     * Required outcome: Groq completes the SAME turn cleanly, the final
     * response is delivered, and the tool executed EXACTLY ONCE.
     * ==================================================================== */
    resetGeminiRouterStateForTests();
    resetGroqProviderStateForTests();

    let echoExecutions = 0;
    const echoToolG = tool({
      name: "echo_stub",
      description: "Echoes the given word back.",
      parameters: z.object({ word: z.string() }),
      execute: async ({ word }) => {
        echoExecutions += 1;
        return { status: "ok", word };
      },
    });

    const agentG = new Agent({
      name: "Stub Business Manager",
      instructions:
        "Use the echo_stub tool exactly once per request, then report the echoed word plainly.",
      model: createBusinessManagerModel(),
      tools: [echoToolG],
    });

    // First Gemini model request of this run = the tool-call turn (slot 1,
    // healthy). Every LATER Gemini request = stream starts, then drops
    // mid-stream. Groq is healthy and must finish the job.
    let gToolTurnServed = false;
    behavior = {
      gemini: () => {
        if (!gToolTurnServed) {
          gToolTurnServed = true;
          return { toolCall: true };
        }
        return { errorMidStream: true };
      },
      groq: { text: "groq-final-answer" },
    };
    attemptLog = [];
    echoExecutions = 0;
    gToolTurnServed = false;
    const g1 = await streamedRun(agentG, "say echo via tool").catch(
      (e) => `ERROR:${expectErrorClassification(e)}`,
    );
    record(
      "SESSION G RUN: post-tool mid-stream Gemini drop → backup completes the SAME turn with a coherent final response",
      typeof g1 === "string" && g1.includes("groq-final-answer"),
      `output="${g1}", executions=${echoExecutions}, attempts=[${attemptsSummary()}]`,
    );
    record(
      "SESSION G RUN: successful mutation is NEVER replayed (tool ran exactly once)",
      echoExecutions === 1,
      `executions=${echoExecutions}`,
    );
    record(
      "SESSION G RUN: mid-stream failure engages the backup exactly once per turn",
      attemptLog.filter((a) => a.kind === "groq").length === 1 &&
        attemptLog.filter((a) => a.kind === "gemini").length >= 2,
      `attempts=[${attemptsSummary()}]`,
    );


    /* ======================================================================
     * SESSION F — provider configuration is re-resolved per request:
     * fixing/adding a key in the environment takes effect on the NEXT
     * request WITHOUT restarting the server or recreating the client.
     * ==================================================================== */
    resetGeminiRouterStateForTests();
    resetGroqProviderStateForTests();

    /** @type {{slot:number, kind:string}[]} */
    const fAttempts = [];
    let fKeysBySlot = { 1: "gk-old-1", 2: "gk-old-2" };
    const fRouter = (
      await import("../../lib/ai/gemini-router.ts")
    ).createGeminiFailoverFetch({
      fetchImpl: async (url, init = {}) => {
        const headers = new Headers(init.headers);
        const key = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        const slot = Number(Object.entries(fKeysBySlot).find(([, k]) => k === key)?.[0] ?? 0);
        fAttempts.push({ slot });
        if (key === "gk-fixed-3") {
          return Response.json(jsonCompletion("served-by-fixed-key", "m"), { status: 200 });
        }
        return Response.json({ error: { message: "quota" } }, { status: 429 });
      },
      resolveProviders: () =>
        Object.entries(fKeysBySlot)
          .filter(([, key]) => Boolean(key))
          .map(([slot, apiKey]) => ({ slot: Number(slot), apiKey })),
    });

    async function fRequest() {
      const response = await fRouter("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { authorization: "Bearer managed-by-gemini-router" },
        body: JSON.stringify({ model: "m", messages: [], stream: false }),
      });
      return response.json();
    }

    // Before the fix: every request fails while the broken keys stay loaded.
    const f1 = await fRequest().catch(() => null);
    const beforeFix = Array.isArray(f1?.choices);

    // Environment corrected (same process, no restart): slot 3 now healthy.
    fKeysBySlot = { 1: "gk-old-1", 2: "gk-old-2", 3: "gk-fixed-3" };
    const f2 = await fRequest().catch(() => null);
    record(
      "SESSION F: corrected provider config applies from the NEXT request without server restart",
      !beforeFix && Array.isArray(f2?.choices) &&
        fAttempts.slice(-3).some((a) => a.slot === 3),
      `attempts=[${fAttempts.map((a) => a.slot).join(",")}]`,
    );

    /* ======================================================================
     * SESSION H — POST-RUN RECOVERY DECISIONS (route-level semantics,
     * docs/check.txt Rules 6/7/12/13/20): confirmed mutations must never be
     * masked by a provider error, and retries must never replay mutations.
     * ==================================================================== */
    {
      const recovery = await import("../../lib/ai/run-recovery.ts");
      const actionDone = (code, params) => ({
        id: `a-${Math.random()}`, code, phase: "done", params,
      });
      const stateOf = (successfulActions, mutationAttempted) => ({
        successfulActions, mutationAttempted,
      });

      // H1: mutation CONFIRMED by the backend, then the whole provider chain
      // died on the final-answer turn → honest confirmation, never a quota
      // error.
      const h1 = recovery.decideRunFailure(
        stateOf([actionDone("customer_added", { name: "Rehan" })], true),
        "ai_overloaded",
        "ur",
      );
      record(
        "SESSION H: post-tool total provider failure → done with synthesized confirmation",
        h1.kind === "done" && h1.text.includes("Rehan"),
        JSON.stringify(h1),
      );
      record(
        "SESSION H: synthesized confirmation uses the selected language (Roman Urdu)",
        h1.kind === "done" && /save hua/i.test(h1.text),
        JSON.stringify(h1),
      );

      const h1en = recovery.decideRunFailure(
        stateOf([actionDone("customer_added", { name: "Rehan" })], true),
        "ai_overloaded",
        "en",
      );
      record(
        "SESSION H: synthesized confirmation respects English selection",
        h1en.kind === "done" && /Customer saved/i.test(h1en.text),
        JSON.stringify(h1en),
      );

      // H2: empty final output after a fully read-only run → one clean retry
      // (reads are side-effect free; nothing can duplicate).
      const h2 = recovery.decideEmptyFinalOutput(stateOf([], false), "ur");
      record(
        "SESSION H: read-only run with empty final output → exactly one clean retry",
        h2.kind === "retry",
        JSON.stringify(h2),
      );

      // H3: empty final output BUT a mutation already committed → done with
      // the confirmation; retrying could duplicate the write.
      const h3 = recovery.decideEmptyFinalOutput(
        stateOf([actionDone("expense_added", { title: "Rent" })], true),
        "ur",
      );
      record(
        "SESSION H: empty final output after successful mutation → confirmation (no retry)",
        h3.kind === "done" && h3.text.includes("Rent"),
        JSON.stringify(h3),
      );

      // H4: mutation FAILED in the backend + providers exhausted → safe error;
      // NEVER a success message for an operation that did not happen.
      const failedAction = { id: "a-f", code: "customer_added", phase: "failed", params: { name: "X" } };
      const h4 = recovery.decideRunFailure(stateOf([], true), "ai_overloaded", "ur");
      record(
        "SESSION H: failed mutation + exhausted providers → safe error, no false success",
        (() => {
          void failedAction;
          return h4.kind === "error" && h4.code === "ai_overloaded";
        })(),
        JSON.stringify(h4),
      );

      // H5: non-provider failure on a read-only run (e.g. max turns) — no
      // pointless retry; classified code surfaces.
      const h5 = recovery.decideRunFailure(stateOf([], false), "response_incomplete", "ur");
      record(
        "SESSION H: non-provider failure on read-only run → immediate classified error",
        h5.kind === "error" && h5.code === "response_incomplete",
        JSON.stringify(h5),
      );

      // H6: multi-action synthesis joins lines and localizes order status.
      const h6Text = recovery.synthesizeConfirmation("ur", [
        actionDone("order_created", { orderNumber: "ORD-7" }),
        actionDone("order_status_changed", { orderNumber: "ORD-7", status: "completed" }),
      ]);
      record(
        "SESSION H: multi-action synthesis lists each confirmed change once",
        h6Text.includes("ORD-7") && h6Text.split("\n").length === 2,
        JSON.stringify(h6Text),
      );
    }

    /* ======================================================================
     * SESSION I — BACKUP ELIGIBILITY PRECISION (Rules 19/20):
     * request-shape failures must NOT burn the last-resort backup, while
     * transport/availability failures MUST still engage it — including on
     * the NON-streaming path, which commits nothing until returned.
     * ==================================================================== */
    resetGeminiRouterStateForTests();
    resetGroqProviderStateForTests();
    {
      const { FailoverModel } = await import("../../lib/ai/failover-model.ts");
      const { APIError } = await import("openai");
      const { isCrossProviderFutileReplay } = await import(
        "../../lib/ai/model-provider.ts"
      );

      record(
        "SESSION I: 400/413/422 APIErrors are cross-provider futile replays; 404/429/network are not",
        isCrossProviderFutileReplay(new APIError(400, { message: "bad" }, undefined, undefined)) &&
          isCrossProviderFutileReplay(new APIError(413, { message: "big" }, undefined, undefined)) &&
          isCrossProviderFutileReplay(new APIError(422, { message: "no" }, undefined, undefined)) &&
          !isCrossProviderFutileReplay(new APIError(404, { message: "model?" }, undefined, undefined)) &&
          !isCrossProviderFutileReplay(new APIError(429, { message: "quota" }, undefined, undefined)) &&
          !isCrossProviderFutileReplay(new Error("connection dropped")),
      );

      // Non-streaming clean replay: a raw unclassified primary failure must
      // still reach resolveBackup with canReplayCleanly=true.
      let seenPhase = null;
      const probeModel = new FailoverModel({
        getPrimary: () => ({
          async getResponse() {
            throw new Error("raw transport death");
          },
          async *getStreamedResponse() {
            yield* [];
            throw new Error("raw transport death");
          },
        }),
        resolveBackup(_err, phase) {
          seenPhase = { ...phase };
          return {
            async getResponse() {
              return {
                output: [
                  {
                    type: "message",
                    role: "assistant",
                    content: [{ type: "output_text", text: "backup-served" }],
                  },
                ],
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              };
            },
            async *getStreamedResponse() {},
          };
        },
        translateBackupError: (e) => e,
      });
      const iResponse = await probeModel.getResponse({ signal: undefined });
      const iBackupText = iResponse.output[0].content[0].text;
      record(
        "SESSION I: non-streaming primary failure is a clean-replay opportunity (backup engaged)",
        iBackupText === "backup-served" && seenPhase?.canReplayCleanly === true,
        `text=${iBackupText} phase=${JSON.stringify(seenPhase)}`,
      );

      // Full-chain integration: Gemini slot returns HTTP 400 with an error
      // body (request-shape pass-through). The backup must stay untouched.
      behavior = {
        gemini: () => ({ status: 400 }),
        groq: { text: "MUST_NOT_APPEAR_I" },
      };
      attemptLog = [];
      let iOutcome = "";
      try {
        await getStreamedText(model, MODEL_REQUEST);
        iOutcome = "NO_ERROR (bad)";
      } catch (error) {
        iOutcome = expectErrorClassification(error);
      }
      record(
        "SESSION I: primary 400 request-shape failure surfaces without engaging groq",
        iOutcome.startsWith("unclassified") || iOutcome.includes("APIError") ||
          iOutcome.includes("BadRequest") || iOutcome.startsWith("GeminiRouterError"),
        `outcome=${iOutcome}, attempts=[${attemptsSummary()}]`,
      );
      record(
        "SESSION I: groq was NOT attempted for the futile 400 replay",
        !attemptLog.some((a) => a.kind === "groq"),
        `attempts=[${attemptsSummary()}]`,
      );

      // Groq reasoning budget: gpt-oss requests carry bounded reasoning_effort.
      resetGeminiRouterStateForTests();
      resetGroqProviderStateForTests();
      lastGroqRequestBody = null;
      const { getGroqBackupModel } = await import("../../lib/ai/groq-provider.ts");
      const groqProbe = getGroqBackupModel();
      try {
        await groqProbe.getResponse(MODEL_REQUEST);
      } catch {
        // Outcome irrelevant; only the outbound body matters here.
      }
      record(
        "SESSION I: gpt-oss backup requests bound reasoning effort to protect completion budget",
        lastGroqRequestBody?.reasoning_effort === "low",
        `reasoning_effort=${lastGroqRequestBody?.reasoning_effort}`,
      );
    }

    /* ======================================================================
     * SESSION J — GEMINI-ONLY REJECTION MUST REACH THE BACKUP
     * (docs/check.txt Step 2/3, live A/B evidence): a 400 whose body demands
     * Google's proprietary `thought_signature` is rejected ONLY by Gemini —
     * the backup serves the identical body. It must therefore NOT be treated
     * as a cross-provider-futile replay.
     * ==================================================================== */
    resetGeminiRouterStateForTests();
    resetGroqProviderStateForTests();
    {
      const thoughtSig400 = () => ({
        status: 400,
        message:
          '[{"error":{"code":400,"message":"Function call is missing a thought_signature in functionCall parts. This is required for tools to work correctly.","status":"INVALID_ARGUMENT"}}]',
      });
      behavior = {
        gemini: thoughtSig400,
        groq: { text: "groq-after-gemini-only-400" },
      };
      attemptLog = [];
      const j1 = await getStreamedText(model, MODEL_REQUEST).catch((e) =>
        `ERROR:${expectErrorClassification(e)}`,
      );
      record(
        "SESSION J: Gemini-only thought_signature 400 engages Groq and serves the answer",
        typeof j1 === "string" && j1.includes("groq-after-gemini-only-400"),
        `text="${j1}", attempts=[${attemptsSummary()}]`,
      );

      // The generic request-shape protection must remain intact: a 400 that
      // does NOT mention Google-only rules still skips the backup.
      resetGeminiRouterStateForTests();
      resetGroqProviderStateForTests();
      behavior = {
        gemini: () => ({ status: 400 }),
        groq: { text: "MUST_NOT_APPEAR_J2" },
      };
      attemptLog = [];
      let j2Outcome = "";
      try {
        await getStreamedText(model, MODEL_REQUEST);
        j2Outcome = "NO_ERROR (bad)";
      } catch (error) {
        j2Outcome = expectErrorClassification(error);
      }
      record(
        "SESSION Jb: genuine cross-provider 400 request-shape failure still skips Groq",
        (j2Outcome.startsWith("unclassified") || j2Outcome.includes("APIError") ||
          j2Outcome.startsWith("GeminiRouterError")) &&
          !attemptLog.some((a) => a.kind === "groq"),
        `outcome=${j2Outcome}, attempts=[${attemptsSummary()}]`,
      );
    }
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
