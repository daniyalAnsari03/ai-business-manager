import "server-only";

import {
  getGeminiModelName,
  getGeminiProviders,
  type GeminiProviderConfig,
  type GeminiRouterFailureCode,
} from "@/lib/ai/gemini-config";

/**
 * Gemini multi-project provider router (server-only).
 *
 * Wraps `fetch` so every model request is attempted against the primary
 * Gemini configuration first; on quota/rate-limit or other provider-level
 * failures the request automatically moves to the next configured provider
 * until one succeeds. When every configured provider fails, a single
 * classified, secret-free error is raised.
 *
 * This is legitimate availability failover across separately configured
 * projects — not a policy bypass. The app never creates or registers
 * Google projects; it only consumes credentials provided via environment.
 *
 * Security notes:
 * - API keys are attached per attempt and never logged.
 * - Logs reference providers by slot number and failure category only.
 */

/** Error thrown when no Gemini provider could complete the request. */
export class GeminiRouterError extends Error {
  readonly name = "GeminiRouterError";
  readonly code: GeminiRouterFailureCode;

  constructor(code: GeminiRouterFailureCode) {
    super(`gemini_router_${code}`);
    this.code = code;
  }
}

const ATTEMPT_TIMEOUT_MS = 60_000;

/**
 * How long a slot is skipped after a real provider failure of each category.
 * Rate limits (quota exhaustion) last longest; transient availability issues
 * recover quickly. Values are deliberately short so a recovered project
 * rejoins the chain on its own.
 */
const FAILURE_COOLDOWN_MS: Record<
  NonNullable<AttemptOutcome["category"]>,
  number
> = {
  rate_limited: 60_000,
  auth_failed: 30_000,
  unavailable: 15_000,
  bad_request: 0,
};

interface AttemptOutcome {
  kind: "success" | "failover" | "abort";
  /** Present for success/abort responses. */
  response?: Response;
  category?: "rate_limited" | "auth_failed" | "unavailable" | "bad_request";
}

function classifyStatus(status: number): AttemptOutcome["category"] {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
    return "unavailable";
  }
  return undefined;
}

/**
 * Extracts `error.message` from an upstream JSON body. Google's
 * OpenAI-compatible endpoint has been observed wrapping the error object in a
 * top-level array (`[{ error: {...} }]`) as well as returning it directly.
 */
function extractUpstreamErrorMessage(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const candidates: unknown[] = Array.isArray(parsed)
      ? parsed
      : [parsed];
    for (const candidate of candidates) {
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        "error" in candidate
      ) {
        const message = (candidate as { error?: { message?: unknown } }).error
          ?.message;
        if (typeof message === "string") return message;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Google's OpenAI-compatible endpoint rejects credential problems with
 * HTTP 400 + an error body ("Please pass a valid API key", ...) instead of
 * 401/403. Such a response is a per-slot AUTH failure and must fail over to
 * the next slot; any other 4xx stays a pass-through request problem.
 */
async function isAuthStyle400(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  try {
    const text = await response.clone().text();
    if (!/\bapi[\s_-]?key\b/i.test(text)) return false;
    return extractUpstreamErrorMessage(text) !== null;
  } catch {
    return false;
  }
}

/**
 * Maximum depth walked when searching an error's `cause` chain for a known
 * provider error. Generous by design: the Agents SDK (and future versions of
 * it) may wrap provider failures in several layers, and missing one must
 * never disable the Groq backup or misclassify the user-facing error.
 */
export const ERROR_CAUSE_CHAIN_MAX_DEPTH = 16;

/**
 * Walks an error's `cause` chain and returns the FIRST error satisfying
 * `match`, or null. Shared by the Groq-backup eligibility check and the chat
 * route's classification so both always agree on what the provider layer
 * reported.
 */
export function findErrorInCauseChain<T extends Error>(
  error: unknown,
  match: (candidate: Error) => boolean,
): T | null {
  let current: unknown = error;
  let depth = 0;
  while (current instanceof Error && depth < ERROR_CAUSE_CHAIN_MAX_DEPTH) {
    if (match(current)) return current as T;
    current = current.cause;
    depth += 1;
  }
  return null;
}

/**
 * Dependencies are injectable so the routing logic can be QA-tested with a
 * stubbed transport without touching real providers.
 *
 * Either a static `providers` list OR a `resolveProviders` factory may be
 * given. The resolver form re-reads the configuration for EVERY request so
 * environment corrections take effect without restarting the server.
 */
export interface RouterDependencies {
  providers?: GeminiProviderConfig[];
  resolveProviders?: () => GeminiProviderConfig[];
  fetchImpl: typeof fetch;
  /** Cooldown store; defaults to a private map (shared instance tracks it). */
  cooldownUntil?: Map<number, number>;
}

async function attempt(
  url: string,
  init: RequestInit,
  provider: GeminiProviderConfig,
  fetchImpl: typeof fetch,
): Promise<AttemptOutcome> {
  const headers = new Headers(init.headers);
  // Replace any credential from the caller with THIS provider's key.
  headers.set("Authorization", `Bearer ${provider.apiKey}`);

  try {
    const response = await fetchImpl(url, { ...init, headers, signal: init.signal });
    let category = classifyStatus(response.status);

    if (!category) {
      // Gemini-specific: credential rejections can arrive as 400 + error body.
      if (await isAuthStyle400(response)) {
        category = "auth_failed";
        console.warn(
          `[ai-router] provider #${provider.slot} rejected credentials (400); trying next provider`,
        );
        try {
          await response.arrayBuffer();
        } catch {
          // Ignore body-drain issues; the outcome classification stands.
        }
        return { kind: "failover", category };
      }
      // A 4xx/5xx that was NOT classified by the status matcher and is NOT a
      // Gemini-specific auth-style 400 is a real provider error.  Throw so
      // the FailoverModel (and ultimately the backup chain) can decide
      // whether to engage.  Previously these were silently passed through
      // as "success" which caused the SDK to treat them as valid
      // completions — masking the error entirely.
      if (response.status >= 400) {
        let bodySnippet = "<unreadable>";
        let bodyText = "";
        try {
          bodyText = await response.clone().text();
          bodySnippet = bodyText.slice(0, 500);
        } catch {
          // Keep the placeholder; the failover outcome stands.
        }
        if (response.status === 400) {
          // Gemini-specific: thought_signature rejection must pass through
          // so the SDK throws APIError and the FailoverModel detects it as
          // a Gemini-only rejection that warrants backup engagement.
          if (/thought[\s_-]?signature/i.test(bodyText)) {
            console.warn(
              `[ai-router] provider #${provider.slot} Gemini thought_signature rejection; passing through`,
            );
            return { kind: "success", response };
          }
          console.warn(
            `[ai-router] provider #${provider.slot} HTTP 400 (non-auth); failing over; body=${bodySnippet}`,
          );
          return { kind: "failover", category: "bad_request" };
        }
        console.warn(
          `[ai-router] provider #${provider.slot} unclassified HTTP ${response.status}; failing over; body=${bodySnippet}`,
        );
        return { kind: "failover", category: "unavailable" };
      }
      return { kind: "success", response };
    }

    console.warn(
      `[ai-router] provider #${provider.slot} failed (${category}); trying next provider`,
    );
    // Drain the body so the socket is released back before retrying.
    try {
      await response.arrayBuffer();
    } catch {
      // Ignore body-drain issues; the outcome classification stands.
    }
    return { kind: "failover", category };
  } catch (error) {
    if (init.signal?.aborted) {
      return { kind: "abort" };
    }
    console.warn(
      `[ai-router] provider #${provider.slot} network failure; trying next provider`,
    );
    void error;
    return { kind: "failover", category: "unavailable" };
  }
}

/** Combines an optional caller signal with a timeout without Node-20-only APIs. */
function combineSignals(
  caller: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onCallerAbort = () => controller.abort();

  if (caller) {
    if (caller.aborted) controller.abort();
    else caller.addEventListener("abort", onCallerAbort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    },
  };
}

/**
 * Creates a fetch-compatible function implementing the failover chain.
 * Used as the transport of the OpenAI client that backs the Agents SDK.
 *
 * Hardening: after a REAL provider-reported failure the slot is put on a
 * short temporary cooldown so an exhausted/unavailable project is not
 * hammered again within the same failure period; requests move straight to
 * the next healthy configuration instead. Cooldowns are only ever set from
 * actual provider error responses (429 / auth / 5xx / network) — never
 * speculatively — and expire automatically, so a recovered project rejoins
 * the chain without any manual state.
 */
export function createGeminiFailoverFetch(
  dependencies: RouterDependencies = {
    fetchImpl: fetch,
    resolveProviders: getGeminiProviders,
  },
): typeof fetch {
  const { fetchImpl, providers: staticProviders, resolveProviders } = dependencies;

  if (staticProviders) {
    // Fixed chain (QA/injectable mode): an empty list is a configuration
    // error that can be reported eagerly.
    if (staticProviders.length === 0) {
      throw new GeminiRouterError("not_configured");
    }
  }

  /** Slot position -> epoch ms until which attempts are skipped. */
  const cooldownUntil =
    dependencies.cooldownUntil ??
    new Map<number, number>();

  return async function geminiFailoverFetch(
    url: string | URL | globalThis.Request,
    init?: RequestInit,
  ): Promise<Response> {
    const requestUrl = String(url);
    const requestInit: RequestInit = init ?? {};
    const callerSignal = requestInit.signal ?? null;

    // Resolve the chain per request: with the resolver form the active
    // provider set is always current — a key added/fixed in the environment
    // joins the rotation without any process restart.
    const providers = staticProviders ?? resolveProviders?.() ?? [];
    if (providers.length === 0) {
      console.error("[ai-router] no Gemini provider is configured");
      throw new GeminiRouterError("not_configured");
    }

    let lastCategory: NonNullable<AttemptOutcome["category"]> = "unavailable";

    // Try providers that are not cooling down first (slot order preserved);
    // cooling candidates are appended AFTER them instead of being dropped, so
    // a recovered project can still serve the request if the "ready" ones
    // fail. Cooldown is an optimization — never an early-exit condition.
    const now = Date.now();
    const ready = providers.filter(
      (provider) => (cooldownUntil.get(provider.slot) ?? 0) <= now,
    );
    const chain =
      ready.length === providers.length
        ? providers
        : [...ready, ...providers.filter((provider) => !ready.includes(provider))];
    if (ready.length < providers.length) {
      console.warn(
        `[ai-router] ${providers.length - ready.length} provider(s) in temporary cooldown; trying them last`,
      );
    }

    try {
      for (const provider of chain) {
        const { signal, dispose } = combineSignals(callerSignal, ATTEMPT_TIMEOUT_MS);

        const outcome = await attempt(
          requestUrl,
          { ...requestInit, signal },
          provider,
          fetchImpl,
        ).finally(dispose);

        if (outcome.kind === "success") {
          // Healthy again — clear any lingering cooldown immediately.
          cooldownUntil.delete(provider.slot);
          return outcome.response!;
        }
        if (outcome.kind === "abort") {
          // Caller cancelled (or hard timeout) — do not keep failing over.
          throw new GeminiRouterError("unavailable");
        }
        lastCategory = outcome.category ?? lastCategory;
        cooldownUntil.set(
          provider.slot,
          Date.now() + FAILURE_COOLDOWN_MS[lastCategory],
        );
      }
    } catch (error) {
      if (error instanceof GeminiRouterError && error.code === "unavailable" && callerSignal?.aborted) {
        // Translate caller-initiated cancellation into a normal abort error
        // so upstream SDK retry/timeout logic treats it as expected.
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      throw error;
    }

    console.error(`[ai-router] all ${chain.length} Gemini providers failed`);
    throw new GeminiRouterError(lastCategory);
  };
}

/** Shared singleton router used by the model provider layer. */
let sharedFetch: typeof fetch | null = null;
let sharedCooldownUntil: Map<number, number> | null = null;

export function getGeminiFailoverFetch(): typeof fetch {
  if (!sharedFetch) {
    sharedCooldownUntil = new Map<number, number>();
    // The provider list is re-resolved per request so environment changes
    // (e.g. a corrected key) apply WITHOUT restarting the server. Only the
    // cooldown store persists for the life of the process.
    sharedFetch = createGeminiFailoverFetch({
      fetchImpl: fetch,
      resolveProviders: getGeminiProviders,
      cooldownUntil: sharedCooldownUntil,
    });
  }
  return sharedFetch;
}

/** Test hook: clears module-level cooldown state. Not used in production paths. */
export function resetGeminiRouterStateForTests(): void {
  sharedCooldownUntil?.clear();
}

/** The Gemini OpenAI-compatible endpoint used by the model layer. */
export const GEMINI_OPENAI_BASE_URL =
  process.env.GEMINI_BASE_URL?.trim() ||
  "https://generativelanguage.googleapis.com/v1beta/openai/";

/** Convenience for callers that only need the resolved model name. */
export function resolveGeminiModel(): string {
  return getGeminiModelName();
}
