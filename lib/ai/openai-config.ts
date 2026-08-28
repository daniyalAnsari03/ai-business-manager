import "server-only";

/**
 * OpenAI primary-provider configuration — server-only.
 *
 * OpenAI (gpt-5.6-luna) is the PRIMARY model provider. The key never
 * leaves the server; logs and errors reference the provider by name/category,
 * never by credential.
 */

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";

export interface OpenAiConfig {
  readonly apiKey: string;
  readonly model: string;
}

function ignorePlaceholder(value: string): boolean {
  return !value || value.startsWith("your-");
}

/**
 * The usable OpenAI configuration, or null when OPENAI_API_KEY is not set.
 * Read on every call so configuration changes are picked up without a
 * process restart in development.
 */
export function getOpenAiConfig(): OpenAiConfig | null {
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (ignorePlaceholder(apiKey)) return null;

  let model = (process.env.OPENAI_MODEL ?? "").trim() || DEFAULT_OPENAI_MODEL;
  if (ignorePlaceholder(model)) model = DEFAULT_OPENAI_MODEL;

  return { apiKey, model };
}
