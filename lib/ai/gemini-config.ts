import "server-only";

/**
 * Gemini provider configuration — server-only.
 *
 * Each configured key is treated as a SEPARATE provider configuration
 * (typically one key per Google AI Studio / Google Cloud project). Keys from
 * the same project do NOT create independent quotas; the router therefore
 * never assumes more keys means more capacity — it only provides failover.
 *
 * The app must work with any number of configured keys (1..N); missing or
 * empty variables are simply ignored. Secret values never leave this module:
 * logs and errors reference providers by ordinal position only.
 */

/** Upper bound of supported provider slots (GEMINI_API_KEY_1..GEMINI_API_KEY_8). */
export const GEMINI_PROVIDER_SLOTS = 8;

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export interface GeminiProviderConfig {
  /** 1-based slot position, safe for logging (never the key itself). */
  readonly slot: number;
  readonly apiKey: string;
}

export type GeminiRouterFailureCode =
  | "not_configured"
  | "rate_limited"
  | "auth_failed"
  | "unavailable"
  | "bad_request";

function readSlotKey(slot: number): string | null {
  const raw = process.env[`GEMINI_API_KEY_${slot}`];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // Ignore obvious placeholder values from .env.example copies.
  if (!trimmed || trimmed.startsWith("your-")) return null;
  return trimmed;
}

/**
 * All usable Gemini provider configurations in priority order
 * (GEMINI_API_KEY_1 first). Empty when no key is configured at all.
 */
export function getGeminiProviders(): GeminiProviderConfig[] {
  const providers: GeminiProviderConfig[] = [];
  for (let slot = 1; slot <= GEMINI_PROVIDER_SLOTS; slot += 1) {
    const apiKey = readSlotKey(slot);
    if (apiKey) providers.push({ slot, apiKey });
  }
  return providers;
}

/** True when at least one Gemini provider configuration exists. */
export function isAiConfigured(): boolean {
  return getGeminiProviders().length > 0;
}

/** Model name used for every provider (configurable via GEMINI_MODEL). */
export function getGeminiModelName(): string {
  const raw = process.env.GEMINI_MODEL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_GEMINI_MODEL;
}
