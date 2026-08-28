/**
 * Prompt 12 / STEP 15 — offline failover matrix.
 *
 * Exercises the REAL application modules (gemini-router, model-provider,
 * groq-provider wiring, Agents SDK chat-completions model) end to end while
 * the HTTP transport is stubbed. No secrets, no network, no business data.
 *
 * Run: node --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/failover-matrix.mjs
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
// Business tools import the service layer; these dummies only satisfy module
// loading — no Supabase call is ever made by this offline matrix.
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://stub.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "stub-anon-key";

/* ---------------------------------------------------------------------------
 * Stubbed HTTP transport.
 * ------------------------------------------------------------------------ */

const GEMINI_HOST = "generativelanguage.googleapis.com";
const GROQ_HOST = "api.groq.com";

/** @type {{slot:number, kind:string, stream:boolean}[]} */
let attemptLog = [];
let behavior = null;

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

function toolCallCompletion(model) {
  return jsonCompletion(null, model, {
    tool_calls: [
      {
        id: "call_stub_1",
        type: "function",
        function: { name: "get_sales_summary", arguments: "{}" },
      },
    ],
  });
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

function statusResponse(status, authBody = false) {
  const message = authBody
    ? "Please pass a valid API key."
    : "stub provider failure";
  return Response.json(
    { error: { message, type: "stub_error" } },
    { status },
  );
}

/**
 * Mirrors Groq's REAL strict tool-schema validator (verified empirically in
 * Prompt 13 against api.groq.com):
 * - any object schema carrying `required` must have at least one property,
 *   otherwise 400 ("'required' present but 'properties' is missing"),
 * - object schemas inside a strict tool need additionalProperties:false.
 * Keeping the stub faithful prevents mock-vs-reality regressions.
 */
function groqStrictSchemaIssue(node, depth = 0) {
  if (depth > 20 || node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const issue = groqStrictSchemaIssue(item, depth + 1);
      if (issue) return issue;
    }
    return null;
  }
  if (node.type === "object") {
    const props = node.properties;
    const hasProps =
      props !== null &&
      typeof props === "object" &&
      !Array.isArray(props) &&
      Object.keys(props).length > 0;
    if ("required" in node && !hasProps) {
      return "'required' present but 'properties' is missing";
    }
    if (node.additionalProperties === undefined && hasProps) {
      // Real Groq rejects strict objects lacking additionalProperties:false;
      // property-less objects are only rejected via the required rule above
      // (verified: {type:'object',properties:{},additionalProperties:false}
      // without required is ACCEPTED).
      return "`additionalProperties:false` must be set on every object";
    }
  }
  for (const key of [
    "properties",
    "items",
    "prefixItems",
    "anyOf",
    "oneOf",
    "allOf",
    "$defs",
    "definitions",
    "patternProperties",
    "additionalProperties",
  ]) {
    const child = node[key];
    if (child === undefined || child === null || typeof child !== "object") continue;
    const issue = groqStrictSchemaIssue(child, depth + 1);
    if (issue) return issue;
  }
  return null;
}

/**
 * Resolves the per-provider plan from the current behavior table.
 * Plans: {status:n} | {text:"..."} | {toolCall:true} | {sseThenBreak:true}
 */
function planFor(providerKey, isStream) {
  const isGroq = providerKey === "groq";
  const table = isGroq ? behavior.groq : behavior.gemini;
  const entry = typeof table === "function"
    ? table(isGroq ? "groq" : providerKey)
    : table;
  if (entry && entry.status) {
    return { respond: () => statusResponse(entry.status, entry.authBody === true) };
  }
  if (entry && entry.sseThenBreak) {
    return {
      respond: () => {
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(enc.encode("data: " + JSON.stringify({
              id: "c", object: "chat.completion.chunk", created: 1, model: "m",
              choices: [{ index: 0, delta: { role: "assistant", content: "par" }, finish_reason: null }],
            }) + "\n\n"));
            controller.error(new Error("stub mid-stream connection reset"));
          },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    };
  }
  if (isStream) {
    return { respond: () => sseResponse(sseChunksFor(entry.text ?? "x", entry.model ?? "m")) };
  }
  if (entry.toolCall) {
    return {
      respond: () =>
        Response.json(toolCallCompletion(entry.model ?? "m"), { status: 200 }),
    };
  }
  return {
    respond: () => Response.json(jsonCompletion(entry.text ?? "ok", entry.model ?? "m"), { status: 200 }),
  };
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
    let payload = null;
    try {
      payload = JSON.parse(String(init.body));
    } catch {}
    if (Array.isArray(payload?.tools)) {
      for (const tool of payload.tools) {
        if (tool?.type !== "function" || !tool.function) continue;
        const issue = groqStrictSchemaIssue(tool.function.parameters);
        if (issue) {
          return Response.json(
            {
              error: {
                message: `invalid JSON schema for tool ${tool.function.name}, function.parameters: ${issue}`,
                type: "invalid_request_error",
              },
            },
            { status: 400 },
          );
        }
      }
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
  modelSettings: { temperature: 0.2, maxTokens: 64, retry: { maxRetries: 0 } },
  tools: [],
  handoffs: [],
  // Production runners serialize a text-output agent as the literal string;
  // any other shape makes the SDK send response_format:json_object upstream.
  outputType: "text",
  tracing: false,
};

async function getFinalText(model, request) {
  const response = await model.getResponse(request);
  const texts = response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .map((part) => part.text ?? "")
    .join("");
  return texts;
}

async function getStreamedText(model, request) {
  let text = "";
  for await (const event of model.getStreamedResponse(request)) {
    if (event.type === "output_text_delta") text += event.delta ?? "";
  }
  return text;
}

function expectErrorClassification(error) {
  // Mirrors the route's findRouterError walk (cause chain).
  let current = error;
  let depth = 0;
  while (current instanceof Error && depth < 6) {
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
  const { resetGroqProviderStateForTests } = await import("../../lib/ai/groq-provider.ts");
  const { resetGeminiRouterStateForTests } = await import("../../lib/ai/gemini-router.ts");

  /** Deterministic per-scenario state: clears router + backup cooldowns. */
  function freshState() {
    resetGeminiRouterStateForTests();
    resetGroqProviderStateForTests();
  }

  // The Agents SDK model layer expects runner-established tracing context.
  await withTrace("failover-matrix", async () => {
    const model = createBusinessManagerModel();

  /* --- TEST 1: Gemini 1 fails (429), Gemini 2 succeeds ------------------- */
  freshState();
  behavior = { gemini: (slot) => (slot === 1 ? { status: 429 } : { text: `slot${slot}` }), groq: { status: 500 } };
  attemptLog = [];
  const t1 = await getFinalText(model, MODEL_REQUEST);
  record(
    "TEST 1 non-streaming: Gemini1 429 → Gemini2 success, no user-facing quota error",
    t1.includes("slot2") &&
      attemptLog.length === 2 &&
      !t1.includes("quota"),
    `text="${t1}", attempts=[${attemptsSummary()}]`,
  );

  /* --- TEST 2: First two fail, third succeeds ---------------------------- */
  freshState();
  behavior = { gemini: (slot) => (slot <= 2 ? { status: 429 } : { text: `slot${slot}` }), groq: { status: 500 } };
  attemptLog = [];
  const t2 = await getFinalText(model, MODEL_REQUEST);
  record(
    "TEST 2 non-streaming: Gemini1-2 429 → Gemini3 success",
    t2.includes("slot3"),
    `text="${t2}", attempts=[${attemptsSummary()}]`,
  );

  /* --- TEST 5: cooling slots are skipped, next available used ------------ */
  // Phase A: put slots 1–2 into cooldown via real 429s; slot 3 serves.
  freshState();
  behavior = { gemini: (slot) => (slot <= 2 ? { status: 429 } : { text: `slot${slot}` }), groq: { status: 500 } };
  attemptLog = [];
  await getFinalText(model, MODEL_REQUEST);

  // Phase B: every "ready" slot fails; slots 1–2 have "recovered". The router
  // must exhaust the ready slots and then fall back INSIDE Gemini to the
  // cooling-but-recovered slots instead of giving up or skipping to Groq.
  behavior = { gemini: (slot) => (slot <= 2 ? { text: `slot${slot}-recovered` } : { status: 429 }) , groq: { text: "MUST_NOT_APPEAR_T5" } };
  attemptLog = [];
  const t5 = await getFinalText(model, MODEL_REQUEST).catch((e) => `ERROR:${expectErrorClassification(e)}`);
  const t5Attempts = attemptLog.map((a) => a.slot);
  record(
    "TEST 5 cooldown: cooling slots are retried last, never dropped — no premature error",
    typeof t5 === "string" &&
      t5.includes("slot1-recovered") &&
      t5Attempts.join(",") === "3,4,5,6,7,8,1",
    `text="${t5}", attempts=[${attemptsSummary()}]`,
  );

  /* --- TEST 3: All Gemini fail → Groq succeeds --------------------------- */
  freshState();
  behavior = { gemini: gemini429, groq: { text: "groq-answer" } };
  attemptLog = [];
  const t3 = await getFinalText(model, MODEL_REQUEST);
  const geminiAttemptsT3 = attemptLog.filter((a) => a.kind === "gemini").length;
  const groqAfterAllGemini = groqIndexAfter(attemptLog, 8);
  record(
    "TEST 3 non-streaming: all 8 Gemini 429 → Groq engaged and succeeds",
    t3.includes("groq-answer") && geminiAttemptsT3 === 8 && groqAfterAllGemini,
    `text="${t3}", attempts=[${attemptsSummary()}]`,
  );

  /* --- TEST 4: All providers fail → final classified error --------------- */
  freshState();
  behavior = { gemini: gemini429, groq: { status: 429 } };
  attemptLog = [];
  let t4Outcome = "";
  try {
    await getFinalText(model, MODEL_REQUEST);
    t4Outcome = "NO_ERROR (bad)";
  } catch (error) {
    t4Outcome = expectErrorClassification(error);
  }
  record(
    "TEST 4: all Gemini fail + Groq 429 → single final provider/quota error",
    t4Outcome === "GroqProviderError:rate_limited" || t4Outcome === "GeminiRouterError:rate_limited",
    `outcome=${t4Outcome}, attempts=[${attemptsSummary()}]`,
  );

  /* --- TEST 4b: Groq recovered during its cooldown ------------------------ */
  // TEST 4 marked Groq rate-limited (cooldown active). Groq is healthy again
  // here; the backup MUST still be attempted instead of surfacing an error.
  behavior = { gemini: gemini429, groq: { text: "groq-recovered" } };
  attemptLog = [];
  const t4b = await getFinalText(model, MODEL_REQUEST).catch((e) => `ERROR:${expectErrorClassification(e)}`);
  record(
    "TEST 4b: backup cooldown does not suppress a working Groq (production incident)",
    typeof t4b === "string" && t4b.includes("groq-recovered"),
    `text="${t4b}", attempts=[${attemptsSummary()}]`,
  );

  /* --- TEST 2b: Gemini-style 400 auth rejection fails over --------------- */
  // Google's OpenAI-compat layer answers invalid keys with HTTP 400 + error
  // body. That must be treated as a per-slot failure, not a final error.
  freshState();
  const auth400 = () => ({ status: 400, authBody: true });
  behavior = { gemini: (slot) => (slot === 1 ? auth400() : { text: `slot${slot}-after-auth400` }), groq: { status: 500 } };
  attemptLog = [];
  const t2b = await getFinalText(model, MODEL_REQUEST).catch((e) => `ERROR:${expectErrorClassification(e)}`);
  record(
    "TEST 2b: Gemini 400 'invalid API key' rejection fails over to next slot",
    typeof t2b === "string" && t2b.includes("slot2-after-auth400"),
    `text="${t2b}", attempts=[${attemptsSummary()}]`,
  );

  /* --- Streaming paths ---------------------------------------------------- */
  freshState();
  behavior = { gemini: (slot) => (slot === 1 ? { status: 429 } : { text: `sse-slot${slot}` }), groq: { status: 500 } };
  attemptLog = [];
  const s1 = await getStreamedText(model, MODEL_REQUEST);
  record(
    "STREAM TEST A: streaming with Gemini1 429 → Gemini2 SSE success",
    s1.includes("sse-slot2"),
    `text="${s1}", attempts=[${attemptsSummary()}]`,
  );

  freshState();
  behavior = { gemini: gemini429, groq: { text: "sse-groq" } };
  attemptLog = [];
  const s2 = await getStreamedText(model, MODEL_REQUEST);
  record(
    "STREAM TEST B: streaming, all 8 Gemini 429 → Groq SSE success",
    s2.includes("sse-groq"),
    `text="${s2}", attempts=[${attemptsSummary()}]`,
  );

  /* --- Mid-stream failure recovery (STEP 11, docs/check.txt §10/Test H) --- */
  freshState();
  behavior = { gemini: () => ({ sseThenBreak: true }), groq: { text: "groq-midstream-recovery" } };
  attemptLog = [];
  let midStream = "";
  try {
    midStream = await getStreamedText(model, MODEL_REQUEST);
    midStream = midStream || "(completed-without-error)";
  } catch (error) {
    midStream = `ERROR:${error?.name ?? "unknown"}`;
  }
  record(
    "STEP 11: mid-stream primary failure recovers via ONE clean backup replay (coherent final response)",
    String(midStream).includes("groq-midstream-recovery") &&
      attemptLog.filter((a) => a.kind === "groq").length === 1 &&
      attemptLog.filter((a) => a.kind === "gemini").length === 1,
    `outcome=${midStream}, attempts=[${attemptsSummary()}]`,
  );

  /* --- Tool-call passthrough after failover (STEP 9) ---------------------- */
  freshState();
  behavior = { gemini: (slot) => (slot === 1 ? { status: 429 } : { toolCall: true, model: "gemini-3.6-flash" }), groq: { status: 500 } };
  attemptLog = [];
  const toolResp = await model.getResponse(MODEL_REQUEST);
  const hasToolCall = toolResp.output.some((item) => item.type === "function_call");
  record(
    "STEP 9: agentic/tool-call request succeeds on Gemini2 after Gemini1 429",
    hasToolCall,
    `attempts=[${attemptsSummary()}]`,
  );

  freshState();
  behavior = { gemini: gemini429, groq: { toolCall: true, model: "openai/gpt-oss-120b" } };
  attemptLog = [];
  const toolRespGroq = await model.getResponse(MODEL_REQUEST);
  const hasToolCallGroq = toolRespGroq.output.some((item) => item.type === "function_call");
  record(
    "STEP 9: tool-call request succeeds via Groq after all Gemini fail",
    hasToolCallGroq,
    `attempts=[${attemptsSummary()}]`,
  );

  /* --- Auth failure classification (STEP 4 coverage) ---------------------- */
  freshState();
  behavior = { gemini: (slot) => (slot === 1 ? { status: 401 } : slot === 2 ? { status: 503 } : { text: "after-auth-failure" }), groq: { status: 500 } };
  attemptLog = [];
  const authCase = await getFinalText(model, MODEL_REQUEST).catch((e) => `ERROR:${expectErrorClassification(e)}`);
  record(
    "STEP 4: 401/5xx are failover conditions, not terminal user errors",
    typeof authCase === "string" && authCase.includes("after-auth-failure"),
    `text="${authCase}", attempts=[${attemptsSummary()}]`,
  );

  /* --- Prompt-13 regression: REAL tool schemas at the Groq boundary ------- */
  // The production agent sends all business tools; the SDK serializes
  // parameterless tools as `required: []` + empty properties, which the real
  // Groq validator rejects with 400 invalid_request. The stub above now
  // enforces the same rule, so these tests only pass when the provider
  // boundary sanitization is active and correct.
  const { businessTools } = await import("../../lib/ai/tools/index.ts");
  const serializedBusinessTools = businessTools.map((tool) => ({
    type: /** @type {const} */ ("function"),
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.parameters,
    strict: tool.strict === true,
  }));
  const parameterlessTools = businessTools.filter((tool) => {
    const params = tool.parameters;
    return (
      params &&
      typeof params === "object" &&
      (!("properties" in params) ||
        !params.properties ||
        Object.keys(/** @type {Record<string, unknown>} */ (params.properties)).length === 0)
    );
  });
  record(
    "Prompt-13 fixture: registry contains parameterless tools (bug precondition)",
    ["low_stock_products", "sales_summary", "expense_summary", "business_overview"].every(
      (name) => parameterlessTools.some((tool) => tool.name === name),
    ),
    `parameterless=[${parameterlessTools.map((t) => t.name).join(",")}]`,
  );
  if (serializedBusinessTools.length > 0) {
    freshState();
    behavior = { gemini: gemini429, groq: { text: "groq-tools-ok" } };
    attemptLog = [];
    const toolsRegression = await getFinalText(model, {
      ...MODEL_REQUEST,
      tools: /** @type {any} */ (serializedBusinessTools),
    }).catch((e) => `ERROR:${expectErrorClassification(e)}`);
    const groqEngagedAfterAllGemini = groqIndexAfter(attemptLog, 8);
    record(
      "Prompt-13: all Gemini fail + REAL business tool schemas → Groq accepts request",
      typeof toolsRegression === "string" &&
        toolsRegression.includes("groq-tools-ok") &&
        groqEngagedAfterAllGemini,
      `text="${toolsRegression}", attempts=[${attemptsSummary()}]`,
    );

    freshState();
    behavior = { gemini: gemini429, groq: { text: "sse-groq-tools" } };
    attemptLog = [];
    const streamedToolsRegression = await getStreamedText(model, {
      ...MODEL_REQUEST,
      tools: /** @type {any} */ (serializedBusinessTools),
    }).catch((e) => `ERROR:${expectErrorClassification(e)}`);
    record(
      "Prompt-13: streaming with REAL business tool schemas → Groq SSE success",
      typeof streamedToolsRegression === "string" &&
        streamedToolsRegression.includes("sse-groq-tools"),
      `text="${streamedToolsRegression}", attempts=[${attemptsSummary()}]`,
    );
  }

  /* ------------------------------------------------------------------------ */
  });

  const failed = results.filter((r) => !r.passed);
  console.log("\n===== SUMMARY =====");
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

function groqIndexAfter(log, minGeminiCount) {
  const idx = log.findIndex((a) => a.kind === "groq");
  if (idx < 0) return false;
  return log.slice(0, idx).filter((a) => a.kind === "gemini").length >= minGeminiCount;
}

main().catch((error) => {
  console.error("HARNESS CRASH:", error);
  process.exitCode = 1;
});
