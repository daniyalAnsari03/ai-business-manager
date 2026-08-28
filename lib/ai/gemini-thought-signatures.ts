import "server-only";

/**
 * Gemini thought-signature carry layer (server-only transport middleware).
 *
 * WHY THIS EXISTS — verified against the live endpoint (docs/check.txt):
 * Gemini 3-series thinking models attach a Google-proprietary
 * `extra_content.google.thought_signature` to every function call they emit.
 * When the Agents SDK replays that assistant turn in the next model request
 * (the post-tool turn), Google REJECTS the request with
 *
 *   HTTP 400 INVALID_ARGUMENT — "Function call is missing a thought_signature
 *   in functionCall parts."
 *
 * because the SDK's OpenAI-wire serialization drops the unknown field. The
 * rejection is Gemini-ONLY: other providers accept the identical request, and
 * replaying it verbatim on Gemini reproduces the 400 while injecting the
 * captured signature returns 200 (live A/B evidence).
 *
 * This module closes the loop at the TRANSPORT boundary so the Agents SDK
 * integration stays untouched:
 *
 *   response side → capture `thought_signature` per tool-call id from
 *                   streamed SSE deltas and JSON bodies (2xx only);
 *   request side  → re-inject the stored signature into assistant messages'
 *                   tool_calls when the id has one.
 *
 * Security notes: signatures are opaque provider tokens; they are never
 * logged and never leave this process except back to Google itself.
 */

/** Bounded store: tool_call id -> signature (insertion-ordered eviction). */
const MAX_STORED_SIGNATURES = 1000;
const storedSignatures = new Map<string, string>();

function rememberSignature(id: string, signature: string): void {
  if (storedSignatures.has(id)) storedSignatures.delete(id);
  storedSignatures.set(id, signature);
  if (storedSignatures.size > MAX_STORED_SIGNATURES) {
    const oldest = storedSignatures.keys().next();
    if (!oldest.done) storedSignatures.delete(oldest.value);
  }
}

interface WireToolCall {
  id?: unknown;
  extra_content?: {
    google?: { thought_signature?: unknown };
  } & Record<string, unknown>;
}

function collectFromToolCalls(toolCalls: unknown): void {
  if (!Array.isArray(toolCalls)) return;
  for (const entry of toolCalls) {
    const candidate = entry as WireToolCall | null | undefined;
    const id = candidate?.id;
    const signature = candidate?.extra_content?.google?.thought_signature;
    if (typeof id === "string" && id.length > 0 && typeof signature === "string") {
      rememberSignature(id, signature);
    }
  }
}

/** Extracts signatures from one parsed SSE frame / JSON response body. */
function collectFromParsedChunk(parsed: unknown): void {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("choices" in parsed)
  ) {
    return;
  }
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return;
  for (const choice of choices) {
    if (typeof choice !== "object" || choice === null) continue;
    const record = choice as {
      delta?: { tool_calls?: unknown };
      message?: { tool_calls?: unknown };
    };
    collectFromToolCalls(record.delta?.tool_calls);
    collectFromToolCalls(record.message?.tool_calls);
  }
}

/**
 * Inspects one line of an upstream body. Handles SSE frames (`data: {...}`)
 * and tolerates plain JSON lines; never throws on malformed input.
 */
function inspectBodyLine(line: string): void {
  let text = line.trim();
  if (text.startsWith("data:")) text = text.slice(5).trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return;
  try {
    collectFromParsedChunk(JSON.parse(text));
  } catch {
    // Malformed/partial line — ignore; signatures arrive on complete frames.
  }
}

/** Wraps a response body so signatures are captured as bytes stream past. */
function tapResponseBody(response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.body || !(response.status >= 200 && response.status < 300)) {
    return response;
  }
  // Only chat-completion payloads can carry signatures; skip everything else
  // (error bodies, empty bodies) untouched.
  if (
    !contentType.includes("json") &&
    !contentType.includes("event-stream")
  ) {
    return response;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        try {
          buffer += decoder.decode(chunk, { stream: true });
          let newlineAt = buffer.indexOf("\n");
          while (newlineAt >= 0) {
            inspectBodyLine(buffer.slice(0, newlineAt));
            buffer = buffer.slice(newlineAt + 1);
            newlineAt = buffer.indexOf("\n");
          }
        } catch {
          // Observability must never break the model stream.
        }
      },
      flush() {
        try {
          if (buffer.trim().length > 0) inspectBodyLine(buffer);
        } catch {
          // Same guarantee as above.
        }
      },
    }),
  );

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

interface WireMessage {
  role?: unknown;
  content?: unknown;
  tool_calls?: Array<WireToolCall & { function?: unknown }>;
}

/**
 * Re-injects stored signatures into every assistant tool_call of the request
 * that is missing one. Returns the ORIGINAL body string when nothing changed
 * so pass-through requests keep byte-identical payloads.
 */
function injectSignatures(bodyText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
  if (typeof parsed !== "object" || parsed === null) return bodyText;
  const messages = (parsed as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return bodyText;

  let changed = false;
  for (const message of messages as WireMessage[]) {
    if (!message || message.role !== "assistant") continue;
    if (!Array.isArray(message.tool_calls)) continue;
    for (const toolCall of message.tool_calls) {
      const id = toolCall?.id;
      if (typeof id !== "string" || id.length === 0) continue;
      const existing =
        toolCall.extra_content?.google?.thought_signature;
      if (typeof existing === "string" && existing.length > 0) continue;
      const signature = storedSignatures.get(id);
      if (!signature) continue;
      toolCall.extra_content = {
        ...toolCall.extra_content,
        google: {
          ...toolCall.extra_content?.google,
          thought_signature: signature,
        },
      };
      changed = true;
    }
  }

  return changed ? JSON.stringify(parsed) : bodyText;
}

/**
 * Test hook: clears module-level state. Not used in production paths.
 */
export function resetGeminiThoughtSignaturesForTests(): void {
  storedSignatures.clear();
}

/**
 * Test hook: direct visibility into whether an id carries a signature.
 */
export function hasStoredThoughtSignature(id: string): boolean {
  return storedSignatures.has(id);
}

/**
 * Wraps a Gemini-bound fetch implementation with transparent thought-
 * signature capture/injection. Compose OUTSIDE the failover router so every
 * slot attempt benefits from the same enriched request body.
 */
export function withGeminiThoughtSignatureCarry(
  fetchImpl: typeof fetch,
): typeof fetch {
  return async function geminiThoughtSignatureFetch(url, init) {
    if (!init || typeof init.body !== "string" || init.method?.toUpperCase() !== "POST") {
      return tapResponseBody(await fetchImpl(url, init));
    }

    let outgoingBody: string;
    try {
      outgoingBody = injectSignatures(init.body);
    } catch {
      outgoingBody = init.body;
    }
    const outgoingInit: RequestInit =
      outgoingBody === init.body ? init : { ...init, body: outgoingBody };

    const response = await fetchImpl(url, outgoingInit);
    return tapResponseBody(response);
  };
}
