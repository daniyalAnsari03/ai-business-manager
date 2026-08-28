import "server-only";

import OpenAI from "openai";
import { APIError } from "openai";
import { OpenAIChatCompletionsModel } from "@openai/agents-openai";
import type {
  Model,
  ModelRequest,
  ModelResponse,
  StreamEvent,
  SerializedTool,
} from "@openai/agents-core";

import {
  GeminiRouterError,
  findErrorInCauseChain,
} from "@/lib/ai/gemini-router";
import type { GeminiRouterFailureCode } from "@/lib/ai/gemini-config";
import { getGroqConfig } from "@/lib/ai/groq-config";

/**
 * Groq backup provider (server-only).
 *
 * Engaged ONLY after the whole Gemini failover chain reports a provider-level
 * failure (quota exhausted / auth rejected / unavailable). Groq shares the
 * same agent, tools and confirmation rules — only the model binding differs.
 *
 * Security notes:
 * - The Groq key stays in this module; never logged, never returned.
 * - Raw upstream error payloads are never surfaced; failures collapse into a
 *   classified, secret-free GroqProviderError handled by the chat route.
 */

/** Classified, secret-free Groq failure codes. */
export type GroqFailureCode =
  | "rate_limited"
  | "auth_failed"
  | "model_unavailable"
  | "unavailable"
  | "invalid_request";

export class GroqProviderError extends Error {
  readonly name = "GroqProviderError";
  readonly code: GroqFailureCode;

  constructor(code: GroqFailureCode) {
    super(`groq_provider_${code}`);
    this.code = code;
  }
}

/**
 * Temporary cooldown per failure category so a failing Groq configuration is
 * not hammered on every request. Values are short for transient issues and
 * long for configuration problems that cannot recover without an env change.
 */
const GROQ_FAILURE_COOLDOWN_MS: Record<GroqFailureCode, number> = {
  rate_limited: 60_000,
  unavailable: 15_000,
  auth_failed: 10 * 60_000,
  model_unavailable: 30 * 60_000,
  invalid_request: 30 * 60_000,
};

let groqCooldownUntil = 0;

/** Marks Groq as temporarily unusable after a REAL classified failure. */
export function markGroqFailure(code: GroqFailureCode, now: number = Date.now()): void {
  groqCooldownUntil = Math.max(groqCooldownUntil, now + GROQ_FAILURE_COOLDOWN_MS[code]);
}

/** True while Groq is serving out a post-failure cooldown. */
export function isGroqCoolingDown(now: number = Date.now()): boolean {
  return groqCooldownUntil > now;
}

/** Test hook: clears module-level cooldown state. Not used in production paths. */
export function resetGroqProviderStateForTests(): void {
  groqCooldownUntil = 0;
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
 * Maps a raw Groq client failure to its classified code. Returns null only
 * for unrecognised errors (e.g. programming errors), which callers must
 * rethrow untouched instead of masking.
 */
export function classifyGroqFailure(error: unknown): GroqFailureCode | null {
  if (!(error instanceof APIError)) return null;
  const status = error.status ?? 0;
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 404 || (status === 400 && looksLikeMissingModel(error))) {
    return "model_unavailable";
  }
  if (status >= 400 && status < 500) return "invalid_request";
  // 408/5xx and connection-level failures (no HTTP status reached).
  return "unavailable";
}

/* ---------------------------------------------------------------------------
 * Failover eligibility
 * ------------------------------------------------------------------------ */

const FAILOVER_TRIGGER_CODES: ReadonlySet<GeminiRouterFailureCode> = new Set([
  "rate_limited",
  "auth_failed",
  "unavailable",
]);

/**
 * True when the Gemini chain failed in a way that legitimately warrants the
 * Groq backup. Permanent programming/request errors (which pass through the
 * Gemini router untouched) never trigger a backup attempt.
 *
 * The search walks the FULL cause chain (generous depth): whatever wraps the
 * provider error upstream, a genuinely exhausted Gemini chain must still
 * reach Groq instead of surfacing a quota error.
 */
export function geminiChainFailureCode(error: unknown): GeminiRouterFailureCode | null {
  const routerError = findErrorInCauseChain<GeminiRouterError>(
    error,
    (candidate) =>
      candidate instanceof GeminiRouterError &&
      FAILOVER_TRIGGER_CODES.has(candidate.code),
  );
  return routerError?.code ?? null;
}

/* ---------------------------------------------------------------------------
 * Backup model resolution
 * ------------------------------------------------------------------------ */

let sharedBackupClient: OpenAI | null = null;
let sharedBackupClientBase: string | null = null;

/**
 * Groq's openai/gpt-oss models are REASONING models: they can spend the whole
 * `max_tokens` completion budget on invisible reasoning and return
 * finish_reason=length with EMPTY visible content. Bounding reasoning effort
 * (a documented Groq chat-completions parameter for this model family) keeps
 * room in the same budget for the user-facing answer. The model itself is
 * untouched — only its sampling parameter is bounded when not set upstream.
 */
function withBoundedReasoning(fetchImpl: typeof fetch): typeof fetch {
  return async function boundedReasoningFetch(url, init) {
    if (typeof init?.body === "string") {
      try {
        const parsed = JSON.parse(init.body) as Record<string, unknown>;
        const model = typeof parsed.model === "string" ? parsed.model : "";
        if (
          /^openai\/gpt-oss/i.test(model) &&
          parsed.reasoning_effort === undefined
        ) {
          parsed.reasoning_effort = "low";
          return fetchImpl(url, { ...init, body: JSON.stringify(parsed) });
        }
      } catch {
        // Non-JSON body — pass through untouched.
      }
    }
    return fetchImpl(url, init);
  };
}

function getBackupClient(baseUrl: string): OpenAI {
  if (!sharedBackupClient || sharedBackupClientBase !== baseUrl) {
    sharedBackupClient = new OpenAI({
      apiKey: getGroqConfig()?.apiKey ?? "",
      baseURL: baseUrl,
      // Retry/cooldown policy is owned by this module, not the HTTP client.
      maxRetries: 0,
      timeout: 60_000,
      fetch: withBoundedReasoning(fetch),
    });
    sharedBackupClientBase = baseUrl;
  }
  return sharedBackupClient;
}

/* ---------------------------------------------------------------------------
 * Tool-schema compatibility
 * ------------------------------------------------------------------------ */

/**
 * Groq validates function-tool JSON schemas more strictly than the primary
 * provider. Empirically its validator:
 * - rejects ANY object schema carrying a `required` key unless at least one
 *   real property exists (including the `z.object({})` shape emitted by the
 *   SDK's zod→JSON-Schema conversion: `required: []` + `properties: {}`),
 * - rejects objects without `additionalProperties: false` (strict mode).
 *
 * The patch happens HERE at the provider boundary so every tool definition in
 * the shared registry stays provider-agnostic; Gemini receives the original
 * schemas untouched.
 */

const SCHEMA_CHILD_KEYS = new Set([
  "properties",
  "items",
  "prefixItems",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "$defs",
  "definitions",
  "patternProperties",
  "additionalProperties",
]);

const MAX_SCHEMA_DEPTH = 12;

function hasUsableProperties(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

function sanitizeSchemaNode(node: unknown, depth: number): unknown {
  if (depth > MAX_SCHEMA_DEPTH || typeof node !== "object" || node === null) {
    return node;
  }
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const sanitized = sanitizeSchemaNode(item, depth + 1);
      if (sanitized !== item) changed = true;
      return sanitized;
    });
    return changed ? next : node;
  }

  const record = node as Record<string, unknown>;
  let working = record;

  if (record.type === "object") {
    // Parameterless/object-valued schemas: Groq refuses a `required` key that
    // does not reference real properties. Dropping it is semantically
    // identical for the model (nothing can be required anyway).
    if ("required" in record && !hasUsableProperties(record.properties)) {
      const { required: _unusedRequired, ...rest } = record;
      void _unusedRequired;
      working = rest;
      if (working.properties === undefined) working.properties = {};
    } else if (working.properties === undefined) {
      working = { ...working, properties: {} };
    }
    if (working.additionalProperties === undefined) {
      if (working === record) working = { ...working };
      working.additionalProperties = false;
    }
  }

  for (const key of Object.keys(working)) {
    if (!SCHEMA_CHILD_KEYS.has(key)) continue;
    const child = working[key];
    if (child === undefined || typeof child !== "object") continue;
    const sanitizedChild = sanitizeSchemaNode(child, depth + 1);
    if (sanitizedChild !== child) {
      if (working === record) working = { ...working };
      working[key] = sanitizedChild;
    }
  }
  return working;
}

/** Returns a Groq-safe copy of the tools, or null when nothing needs changing. */
function groqSafeTools(tools: SerializedTool[] | undefined): SerializedTool[] | null {
  if (!tools || tools.length === 0) return null;
  let changed = false;
  const next = tools.map((entry) => {
    if (!entry || entry.type !== "function") return entry;
    const parameters = entry.parameters as unknown;
    const sanitized = sanitizeSchemaNode(parameters, 0);
    if (sanitized === parameters) return entry;
    changed = true;
    return { ...entry, parameters: sanitized } as SerializedTool;
  });
  return changed ? next : null;
}

function withGroqSafeToolSchemas(request: ModelRequest): ModelRequest {
  const tools = groqSafeTools(request.tools);
  return tools ? { ...request, tools } : request;
}

/**
 * The Groq-backed model bound to the SAME Agents SDK model interface. Tool
 * schemas, instructions and streaming come from the existing agent setup.
 * Tool JSON schemas are normalized for Groq's stricter validator on the way
 * through; nothing else about the request is altered.
 */
export function getGroqBackupModel(): Model | null {
  const config = getGroqConfig();
  if (!config) return null;
  const inner = new OpenAIChatCompletionsModel(
    getBackupClient(config.baseUrl),
    config.model,
  );
  const backupModel: Model = {
    async getResponse(request: ModelRequest): Promise<ModelResponse> {
      return inner.getResponse(withGroqSafeToolSchemas(request));
    },
    getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
      return inner.getStreamedResponse(withGroqSafeToolSchemas(request));
    },
  };
  return backupModel;
}
