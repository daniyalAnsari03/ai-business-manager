import "server-only";

import OpenAI from "openai";
import { APIError } from "openai";
import { OpenAIChatCompletionsModel } from "@openai/agents-openai";
import type {
  Model,
  ModelRequest,
  ModelResponse,
  StreamEvent,
} from "@openai/agents-core";

import { getOpenAiConfig } from "@/lib/ai/openai-config";

/**
 * OpenAI primary provider (server-only).
 *
 * Engaged as the FIRST model in the failover chain:
 *
 *   OpenAI (gpt-5.6-luna) — PRIMARY
 *     ↓ only on a real provider-level failure
 *   Gemini Slot 1..8 (existing chain, untouched)
 *     ↓ only after the whole Gemini chain fails
 *   Groq (existing final backup, untouched)
 *
 * Security notes:
 * - The OpenAI key stays in this module; never logged, never returned.
 * - Raw upstream error payloads are never surfaced; failures collapse into a
 *   classified, secret-free OpenAiProviderError handled by the chat route.
 */

/** Classified, secret-free OpenAI failure codes. */
export type OpenAiFailureCode =
  | "rate_limited"
  | "auth_failed"
  | "model_unavailable"
  | "unavailable"
  | "invalid_request"
  | "insufficient_balance";

export class OpenAiProviderError extends Error {
  readonly name = "OpenAiProviderError";
  readonly code: OpenAiFailureCode;

  constructor(code: OpenAiFailureCode) {
    super(`openai_provider_${code}`);
    this.code = code;
  }
}

/**
 * Temporary cooldown per failure category so a failing OpenAI configuration
 * is not hammered on every request. Values mirror the other providers' proven
 * cooldown policy: short for transient issues, long for configuration problems.
 */
const OPENAI_FAILURE_COOLDOWN_MS: Record<OpenAiFailureCode, number> = {
  rate_limited: 60_000,
  unavailable: 15_000,
  auth_failed: 10 * 60_000,
  model_unavailable: 30 * 60_000,
  invalid_request: 30 * 60_000,
  insufficient_balance: 60 * 60_000,
};

let openAiCooldownUntil = 0;

/** Marks OpenAI as temporarily unusable after a REAL classified failure. */
export function markOpenAiFailure(
  code: OpenAiFailureCode,
  now: number = Date.now(),
): void {
  openAiCooldownUntil = Math.max(
    openAiCooldownUntil,
    now + OPENAI_FAILURE_COOLDOWN_MS[code],
  );
}

/** True while OpenAI is serving out a post-failure cooldown. */
export function isOpenAiCoolingDown(now: number = Date.now()): boolean {
  return openAiCooldownUntil > now;
}

/** Test hook: clears module-level cooldown state. Not used in production. */
export function resetOpenAiProviderStateForTests(): void {
  openAiCooldownUntil = 0;
}

/* ---------------------------------------------------------------------------
 * Failure classification
 * ------------------------------------------------------------------------ */

function looksLikeMissingModel(error: APIError): boolean {
  const detail =
    (error as unknown as { error?: { code?: unknown } }).error?.code ?? "";
  const haystack = `${detail} ${error.message}`;
  return /model[_ ]?not[_ ]?found|decommission|does not exist/i.test(haystack);
}

/**
 * Maps a raw OpenAI client failure to its classified code. Returns null only
 * for unrecognised errors (e.g. programming errors), which callers must
 * rethrow untouched instead of masking.
 */
export function classifyOpenAiFailure(
  error: unknown,
): OpenAiFailureCode | null {
  if (!(error instanceof APIError)) return null;
  const status = error.status ?? 0;
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 402) return "insufficient_balance";
  if (status === 404 || (status === 400 && looksLikeMissingModel(error))) {
    return "model_unavailable";
  }
  if (status >= 400 && status < 500) return "invalid_request";
  // 408/5xx and connection-level failures (no HTTP status reached).
  return "unavailable";
}

/* ---------------------------------------------------------------------------
 * Backup model resolution
 * ------------------------------------------------------------------------ */

let sharedClient: OpenAI | null = null;

/**
 * GPT-5.x models are reasoning models: they can spend the whole `max_tokens`
 * completion budget on invisible reasoning and return finish_reason=length
 * with EMPTY visible content. Bounding reasoning effort keeps room in the
 * same budget for the user-facing answer. The model itself is untouched —
 * only its sampling parameter is bounded when not set upstream.
 *
 * IMPORTANT: gpt-5.6-luna (and likely other GPT-5.6 variants) reject any
 * reasoning_effort value other than `"none"` when the request includes
 * function tools via the Chat Completions endpoint. The error is:
 *   "Function tools with reasoning_effort are not supported for gpt-5.6-luna
 *    in /v1/chat/completions. To use function tools, use /v1/responses or
 *    set reasoning_effort to 'none'."
 * Since this agent always attaches tools (the full business tool registry),
 * reasoning_effort is set to `"none"` for every request. If no tools are
 * present (unreachable for this agent but handled defensively), `"low"` is
 * used as the default effort to preserve token budget.
 */
function withBoundedReasoning(fetchImpl: typeof fetch): typeof fetch {
  return async function boundedReasoningFetch(url, init) {
    if (typeof init?.body === "string") {
      try {
        const parsed = JSON.parse(init.body) as Record<string, unknown>;
        const model = typeof parsed.model === "string" ? parsed.model : "";
        if (
          /^gpt-5/i.test(model) &&
          parsed.reasoning_effort === undefined
        ) {
          const tools = Array.isArray(parsed.tools) ? parsed.tools : [];
          parsed.reasoning_effort = tools.length > 0 ? "none" : "low";
          return fetchImpl(url, { ...init, body: JSON.stringify(parsed) });
        }
      } catch {
        // Non-JSON body — pass through untouched.
      }
    }
    return fetchImpl(url, init);
  };
}

/**
 * GPT-5.x reasoning models (including gpt-5.6-luna) reject the legacy
 * `max_tokens` parameter and require `max_completion_tokens` instead. The
 * Agents SDK sets `modelSettings.maxTokens` which the OpenAI Chat
 * Completions SDK translates to `max_tokens` in the request body — this
 * shim renames that key to `max_completion_tokens` before the request
 * leaves the wire, without touching the shared modelSettings value used by
 * Gemini/Groq (which don't have this constraint).
 */
function withMaxCompletionTokens(fetchImpl: typeof fetch): typeof fetch {
  return async function maxCompletionTokensFetch(url, init) {
    if (typeof init?.body === "string") {
      try {
        const parsed = JSON.parse(init.body) as Record<string, unknown>;
        if (
          typeof parsed.max_tokens === "number" &&
          parsed.max_completion_tokens === undefined
        ) {
          parsed.max_completion_tokens = parsed.max_tokens;
          delete parsed.max_tokens;
          return fetchImpl(url, { ...init, body: JSON.stringify(parsed) });
        }
      } catch {
        // Non-JSON body — pass through untouched.
      }
    }
    return fetchImpl(url, init);
  };
}

function getOpenAiClient(): OpenAI {
  if (!sharedClient) {
    sharedClient = new OpenAI({
      // No custom base URL — use OpenAI's own endpoint (default).
      apiKey: getOpenAiConfig()?.apiKey ?? "",
      // Retry/cooldown policy is owned by this module, not the HTTP client.
      maxRetries: 0,
      timeout: 60_000,
      // Chain both shims: reasoning-effort bounding + max_tokens rename.
      // Order: outer → inner. The request passes through withMaxCompletionTokens
      // first (renames the key), then withBoundedReasoning (adds reasoning_effort).
      fetch: withMaxCompletionTokens(withBoundedReasoning(fetch)),
    });
  }
  return sharedClient;
}

/**
 * OpenAI model bound to the Agents SDK model interface. Tool schemas are
 * passed through unchanged — OpenAI's schema validation is the reference
 * standard and does not need the sanitization applied for Groq.
 */
export function getOpenAiModel(): Model | null {
  const config = getOpenAiConfig();
  if (!config) return null;
  const inner = new OpenAIChatCompletionsModel(
    getOpenAiClient(),
    config.model,
  );
  return {
    async getResponse(request: ModelRequest): Promise<ModelResponse> {
      const result = await inner.getResponse(request);
      console.warn(
        `[ai-provider] openai_direct: model served response directly (no fallback)`,
      );
      return result;
    },
    getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
      return inner.getStreamedResponse(request);
    },
  };
}
