import "server-only";

/**
 * Groq backup-provider configuration — server-only.
 *
 * Groq is a BACKUP provider only: it is engaged after the Gemini failover
 * chain cannot serve a request. The key never leaves the server; logs and
 * errors reference the provider by name/category, never by credential.
 */

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1/";

export interface GroqConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
}

function ignorePlaceholder(value: string): boolean {
  // Ignore obvious placeholder values copied from .env.example.
  return !value || value.startsWith("your-");
}

/**
 * The usable Groq configuration, or null when GROQ_API_KEY is not set.
 * Read on every call so configuration changes are picked up without a
 * process restart in development.
 */
export function getGroqConfig(): GroqConfig | null {
  const apiKey = (process.env.GROQ_API_KEY ?? "").trim();
  if (ignorePlaceholder(apiKey)) return null;

  let baseUrl = (process.env.GROQ_BASE_URL ?? "").trim() || DEFAULT_GROQ_BASE_URL;
  if (!baseUrl.endsWith("/")) baseUrl += "/";

  let model = (process.env.GROQ_MODEL ?? "").trim() || DEFAULT_GROQ_MODEL;
  if (ignorePlaceholder(model)) model = DEFAULT_GROQ_MODEL;

  return { apiKey, baseUrl, model };
}
