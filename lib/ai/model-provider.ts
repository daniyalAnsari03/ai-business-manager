import "server-only";

import OpenAI, { APIError } from "openai";
import { OpenAIChatCompletionsModel } from "@openai/agents-openai";
import { setTracingDisabled } from "@openai/agents";
import type { Model } from "@openai/agents-core";

import {
  GEMINI_OPENAI_BASE_URL,
  GeminiRouterError,
  findErrorInCauseChain,
  getGeminiFailoverFetch,
  resolveGeminiModel,
} from "@/lib/ai/gemini-router";
import { withGeminiThoughtSignatureCarry } from "@/lib/ai/gemini-thought-signatures";
import { getGeminiProviders } from "@/lib/ai/gemini-config";
import { FailoverModel } from "@/lib/ai/failover-model";
import {
  GroqProviderError,
  classifyGroqFailure,
  geminiChainFailureCode,
  getGroqBackupModel,
  isGroqCoolingDown,
  markGroqFailure,
} from "@/lib/ai/groq-provider";
import {
  OpenAiProviderError,
  classifyOpenAiFailure,
  getOpenAiModel,
  isOpenAiCoolingDown,
  markOpenAiFailure,
} from "@/lib/ai/openai-provider";

/**
 * Model provider layer (server-only) — the ONLY place where the Agents SDK
 * is bound to a concrete LLM provider. Everything above this file works
 * against the stable Agents SDK interfaces; swapping providers later means
 * changing this module alone.
 *
 * The failover chain is:
 *
 *   OpenAI (gpt-5.6-luna) — PRIMARY
 *     ↓ only on a real provider-level failure
 *   Gemini project 1..8 (existing chain, untouched internally)
 *     ↓ only after the whole chain reports a provider-level failure
 *   Groq backup provider (existing final backup, untouched internally)
 *
 * OpenAI is the outermost FailoverModel. Its backup is itself a
 * FailoverModel wrapping (Gemini → Groq). This nesting is intentional:
 * FailoverModel is a plain Model, so it composes cleanly.
 *
 * When no OpenAI key is configured, the behavior falls back to
 * Gemini-primary + Groq-backup chain unchanged.
 *
 * Tracing is disabled: it would require OpenAI credentials we deliberately
 * do not use or ship.
 */

setTracingDisabled(true);

/* ---------------------------------------------------------------------------
 * Gemini client (used inside the Gemini+Groq fallback chain)
 * ------------------------------------------------------------------------ */

let sharedGeminiClient: OpenAI | null = null;

function getGeminiClient(): OpenAI {
  if (!sharedGeminiClient) {
    sharedGeminiClient = new OpenAI({
      // The real credential is attached per attempt by the failover router;
      // the client-level key is a non-secret placeholder.
      apiKey: "managed-by-gemini-router",
      baseURL: GEMINI_OPENAI_BASE_URL,
      fetch: withGeminiThoughtSignatureCarry(getGeminiFailoverFetch()),
      // Failover/retry policy is owned entirely by the router.
      maxRetries: 0,
    });
  }
  return sharedGeminiClient;
}

/* ---------------------------------------------------------------------------
 * OpenAI error diagnostic logging
 * ------------------------------------------------------------------------ */

/**
 * Extracts detailed, secret-free diagnostic text from an OpenAI error.
 * Mirrors describeFutileReplayError but is intentionally separate so each
 * provider's diagnostics can evolve independently.
 */
function describeOpenAiError(error: unknown): string {
  if (!(error instanceof APIError)) {
    return `non_api_error=${String(error).slice(0, 300)}`;
  }
  let bodyText = "<none>";
  const rawBody = (error as { error?: unknown }).error;
  if (typeof rawBody === "string") {
    bodyText = rawBody.slice(0, 500);
  } else if (rawBody !== undefined && rawBody !== null) {
    try {
      bodyText = JSON.stringify(rawBody).slice(0, 500);
    } catch {
      bodyText = "<unserializable>";
    }
  }
  return `status=${error.status ?? "?"} message=${JSON.stringify(error.message)} body=${bodyText}`;
}

/* ---------------------------------------------------------------------------
 * Cross-provider futile-replay detection
 * ------------------------------------------------------------------------ */

/**
 * OpenAI-specific 400 rejections that are NOT universally futile — Gemini and
 * Groq do not share OpenAI's exact JSON-Schema format validation restrictions,
 * so these should NOT prevent backup engagement.  Matches the error body:
 *   "Invalid schema for function 'create_product': ... 'uri' is not a valid format."
 * Also covers the earlier max_tokens / reasoning_effort rejections (already
 * handled by fetch shims, but this is a safety net).
 */
function isOpenAiSchemaValidationRejection(error: APIError): boolean {
  if ((error.status ?? 0) !== 400) return false;
  const msg = `${error.message ?? ""} ${JSON.stringify((error as { error?: unknown }).error ?? "")}`;
  return (
    /Invalid schema for function/i.test(msg) ||
    /is not a valid format/i.test(msg) ||
    /Unsupported parameter/i.test(msg) ||
    /not supported with this model/i.test(msg)
  );
}

/**
 * True when a failed primary attempt is pointless to replay on the backup.
 * Covers clearly universal shape problems (413/422).  400 is included ONLY
 * when it is NOT an OpenAI-specific schema/parameter rejection (which Gemini
 * and Groq may handle differently — see isOpenAiSchemaValidationRejection).
 *
 * Gemini-specific 400 rejections (e.g. thought_signature) are handled
 * BEFORE this check via `isGeminiOnlyToolHistoryRejection` — so they
 * still engage the backup.
 */
export function isCrossProviderFutileReplay(error: unknown): error is APIError {
  if (!(error instanceof APIError)) return false;
  const status = error.status ?? 0;
  // 413/422 are always cross-provider-futile.
  if (status === 413 || status === 422) return true;
  // 400 is cross-provider-futile ONLY when it is NOT an OpenAI-specific
  // schema/parameter validation rejection (which other providers may handle
  // differently).  OpenAI-specific 400s fall through to the backup chain.
  if (status === 400 && !isOpenAiSchemaValidationRejection(error)) return true;
  return false;
}

/**
 * Diagnostic detail for a futile-replay decision: the exact upstream status,
 * message and error body that triggered it (truncated, secret-free — error
 * bodies never contain credentials). Needed to verify the 400/413/422 set is
 * not swallowing capacity/quota-style responses misclassified by the router.
 */
function describeFutileReplayError(error: APIError): string {
  let bodyText = "<none>";
  const rawBody = (error as { error?: unknown }).error;
  if (typeof rawBody === "string") {
    bodyText = rawBody.slice(0, 500);
  } else if (rawBody !== undefined && rawBody !== null) {
    try {
      bodyText = JSON.stringify(rawBody).slice(0, 500);
    } catch {
      bodyText = "<unserializable>";
    }
  }
  return `status=${error.status ?? "?"} message=${JSON.stringify(
    error.message,
  )} body=${bodyText}`;
}

/**
 * Google-proprietary validation rejections. Gemini 3-series thinking models
 * sign every function call with `extra_content.google.thought_signature` and
 * reject replays of that turn when the field is missing — a rule ONLY Gemini
 * enforces (live A/B evidence, docs/check.txt): the identical body returns
 * HTTP 400 on Gemini but is served normally by the backup provider. Such a
 * failure is therefore NOT a cross-provider-futile replay.
 *
 * The transport carry layer (gemini-thought-signatures) prevents this error
 * in the first place; this predicate is the safety net for anything the
 * capture could ever miss (e.g. upstream wire-format changes).
 */
function isGeminiOnlyToolHistoryRejection(error: APIError): boolean {
  return (
    (error.status ?? 0) === 400 &&
    /thought[\s_-]?signature/i.test(error.message ?? "")
  );
}

/* ---------------------------------------------------------------------------
 * Gemini + Groq fallback chain (the existing behavior, extracted)
 * ------------------------------------------------------------------------ */

/**
 * Builds the existing Gemini-primary + Groq-backup FailoverModel. This is
 * exactly what createBusinessManagerModel() did before OpenAI was added.
 * Extracted here so the outer OpenAI FailoverModel can nest it as backup.
 *
 * Throws GeminiRouterError('not_configured') when no Gemini key exists.
 */
function createGeminiWithGroqFallback(): Model {
  if (getGeminiProviders().length === 0) {
    throw new GeminiRouterError("not_configured");
  }
  const primary = new OpenAIChatCompletionsModel(
    getGeminiClient(),
    resolveGeminiModel(),
  );
  return new FailoverModel({
    getPrimary: () => primary,
    resolveBackup(primaryError, phase) {
      if (getGroqBackupModel() === null) return null;
      // Gemini-specific: a 400 that demands Google's proprietary
      // thought_signature is rejected ONLY by Gemini — the backup serves
      // the identical body. Check this BEFORE the cross-provider futile
      // set (which now includes 400) so these still engage the backup.
      if (isGeminiOnlyToolHistoryRejection(primaryError as APIError)) {
        console.warn(
          "[ai-provider] gemini rejected by a Gemini-only tool-history rule; engaging groq backup",
        );
        return getGroqBackupModel();
      }
      if (isCrossProviderFutileReplay(primaryError)) {
        console.warn(
          `[ai-provider] gemini failed with a request-shape error; not engaging groq backup (${describeFutileReplayError(primaryError as APIError)})`,
        );
        return null;
      }
      // GeminiRouterError("bad_request") means a non-auth HTTP 400 was
      // rejected by the router. The backup would receive the same malformed
      // request — do not waste the last-resort attempt.  The SDK wraps
      // fetch-origin errors in APIConnectionError, so search the cause chain.
      const badRequestRouterError = findErrorInCauseChain<GeminiRouterError>(
        primaryError,
        (e): e is GeminiRouterError =>
          e instanceof GeminiRouterError && e.code === "bad_request",
      );
      if (badRequestRouterError) {
        console.warn(
          `[ai-provider] gemini rejected with bad_request; not engaging groq backup`,
        );
        return null;
      }
      if (phase.canReplayCleanly) {
        console.warn(
          "[ai-provider] gemini failed before any output reached the run; engaging groq backup (clean retry)",
        );
        return getGroqBackupModel();
      }
      const trigger = geminiChainFailureCode(primaryError);
      if (!trigger) return null;
      if (isGroqCoolingDown()) {
        console.warn(
          `[ai-provider] groq backup engaged despite cooldown (${trigger}); last-resort attempt`,
        );
      } else {
        console.warn(
          `[ai-provider] all gemini providers failed (${trigger}); engaging groq backup`,
        );
      }
      return getGroqBackupModel();
    },
    translateBackupError(backupError) {
      if (backupError instanceof GroqProviderError) {
        return backupError;
      }
      const code = classifyGroqFailure(backupError);
      if (!code) {
        console.error("[ai-provider] groq backup failed with unclassified error");
        return backupError instanceof Error
          ? backupError
          : new Error("groq_provider_failed");
      }
      markGroqFailure(code);
      console.warn(`[ai-provider] groq backup failed (${code})`);
      return new GroqProviderError(code);
    },
  });
}

/* ---------------------------------------------------------------------------
 * Primary entry point: OpenAI → Gemini+Groq
 * ------------------------------------------------------------------------ */

/**
 * Resolves the business manager's model through the configured provider
 * chain: OpenAI (primary) → Gemini (backup) → Groq (final backup).
 *
 * When no OpenAI key is configured, falls back to Gemini+Groq unchanged.
 */
export function createBusinessManagerModel(): Model {
  const openAiPrimary = getOpenAiModel();
  if (!openAiPrimary) {
    console.warn(
      "[ai-provider] openai config not resolved; no API key — falling back to gemini+groq",
    );
    return createGeminiWithGroqFallback();
  }
  console.warn(
    "[ai-provider] openai primary engaged (model will be used for first attempt on each request)",
  );

  const geminiGroqFallback = createGeminiWithGroqFallback();

  return new FailoverModel({
    getPrimary: () => openAiPrimary,
    resolveBackup(primaryError, phase) {
      // A request-shape failure from OpenAI would be rejected identically
      // by Gemini/Groq — do not waste a backup attempt.
      if (isCrossProviderFutileReplay(primaryError)) {
        console.warn(
          `[ai-provider] openai failed with a request-shape error; not engaging gemini+groq backup (${describeFutileReplayError(primaryError)})`,
        );
        return null;
      }
      // Clean-replay phase: the primary stream failed before ANY event
      // reached downstream, so engaging the backup is always side-effect-safe.
      if (phase.canReplayCleanly) {
        console.warn(
          `[ai-provider] openai failed before any output reached the run; engaging gemini+groq backup (clean retry) — DETAIL: ${describeOpenAiError(primaryError)}`,
        );
        return geminiGroqFallback;
      }
      // For classified failures (rate_limited, auth_failed, unavailable),
      // engage the backup. For unclassified errors, still engage — the
      // backup may handle it differently.
      const code = classifyOpenAiFailure(primaryError);
      // OpenAI-specific schema/parameter validation rejections (e.g. invalid
      // JSON-Schema format like "uri") are NOT universally futile — Gemini
      // and Groq do not share these restrictions.  Engage the backup chain.
      if (
        code === "invalid_request" &&
        isOpenAiSchemaValidationRejection(primaryError as APIError)
      ) {
        console.warn(
          `[ai-provider] openai rejected with a schema-validation error (provider-specific); engaging gemini+groq backup — DETAIL: ${describeOpenAiError(primaryError)}`,
        );
        if (code) markOpenAiFailure(code);
        return geminiGroqFallback;
      }
      if (code === "invalid_request") {
        // Truly futile request-shape errors — every provider would reject
        // the same malformed body. Do not waste a backup attempt.
        console.warn(
          `[ai-provider] openai failed with invalid_request; not engaging backup — DETAIL: ${describeOpenAiError(primaryError)}`,
        );
        return null;
      }
      if (code === "insufficient_balance") {
        // The OpenAI account has no credits. The backup (Gemini+Groq) uses
        // different accounts and CAN serve this request. Engage immediately.
        console.warn(
          `[ai-provider] openai account has insufficient balance; engaging gemini+groq backup — DETAIL: ${describeOpenAiError(primaryError)}`,
        );
        markOpenAiFailure(code);
        return geminiGroqFallback;
      }
      if (isOpenAiCoolingDown()) {
        console.warn(
          `[ai-provider] gemini+groq backup engaged despite openai cooldown (${code ?? "unclassified"}); last-resort attempt — DETAIL: ${describeOpenAiError(primaryError)}`,
        );
      } else {
        console.warn(
          `[ai-provider] openai failed (${code ?? "unclassified"}); engaging gemini+groq backup — DETAIL: ${describeOpenAiError(primaryError)}`,
        );
      }
      if (code) markOpenAiFailure(code);
      return geminiGroqFallback;
    },
    translateBackupError(backupError) {
      // The inner FailoverModel (Gemini+Groq) already translates its own
      // internal errors. This outer translateBackupError only needs to
      // handle the case where the ENTIRE inner chain failed.
      if (backupError instanceof OpenAiProviderError) {
        return backupError;
      }
      if (backupError instanceof GroqProviderError) {
        // Gemini+Groq chain exhausted — the last-resort provider also failed.
        return backupError;
      }
      const code = classifyOpenAiFailure(backupError);
      if (code) {
        markOpenAiFailure(code);
        console.warn(
          `[ai-provider] gemini+groq chain exhausted; openai-classified error (${code}) — DETAIL: ${describeOpenAiError(backupError)}`,
        );
        return new OpenAiProviderError(code);
      }
      // Unknown/programming error — surface it instead of masking it.
      console.error(
        `[ai-provider] gemini+groq chain exhausted with unclassified error — DETAIL: ${describeOpenAiError(backupError)}`,
      );
      return backupError instanceof Error
        ? backupError
        : new Error("backup_chain_failed");
    },
  });
}
