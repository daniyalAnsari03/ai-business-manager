/**
 * Real (live) Groq provider ping — Prompt 12 / STEP 3 + TEST 6.
 *
 * Harmless, non-destructive: one tiny chat completion against the same
 * endpoint/model the app uses. Prints only status categories and response
 * text; NEVER prints the API key or any secret.
 *
 * Run: node --env-file=.env.local tests/ai/real-groq-ping.mjs
 */
import OpenAI from "openai";

const apiKey = (process.env.GROQ_API_KEY ?? "").trim();
const model = (process.env.GROQ_MODEL ?? "").trim() || "openai/gpt-oss-120b";

console.log(`GROQ_API_KEY: ${apiKey && !apiKey.startsWith("your-") ? "configured" : "MISSING"}`);
console.log(`GROQ_MODEL: ${model}`);

if (!apiKey || apiKey.startsWith("your-")) {
  console.log("RESULT: FAIL (key not configured)");
  process.exit(1);
}

const client = new OpenAI({
  apiKey,
  baseURL: process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1/",
  maxRetries: 0,
  timeout: 60_000,
});

try {
  const started = Date.now();
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
    max_completion_tokens: 2048,
  });
  const text = completion.choices?.[0]?.message?.content ?? "";
  console.log(`TRANSPORT: success (${Date.now() - started}ms)`);
  console.log(`RESPONSE MODEL: ${completion.model}`);
  console.log(`RESPONSE TEXT: ${text.trim().slice(0, 120)}`);
  console.log(
    text ? "RESULT: SUCCESS" : "RESULT: FAIL (empty response content)",
  );
  if (!text) process.exitCode = 1;
} catch (error) {
  const status = error?.status ?? "no-http-status";
  const code = error?.code ?? error?.error?.code ?? "no-code";
  console.log(`TRANSPORT: failed (status=${status}, code=${code})`);
  console.log(`REASON CATEGORY: ${error?.constructor?.name ?? "unknown"}`);
  // Message may embed upstream detail; keep it but strip anything key-like.
  const safeMessage = String(error?.message ?? error)
    .replace(/gsk_[A-Za-z0-9]+/g, "[redacted]")
    .slice(0, 300);
  console.log(`DETAIL: ${safeMessage}`);
  console.log("RESULT: FAIL");
  process.exitCode = 1;
}
