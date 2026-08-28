/**
 * Direct probe of the real gemini-router transport vs the raw endpoint.
 * Run: node --env-file=.env.local --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/router-probe.mjs
 */

process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
process.env.GEMINI_API_KEY_1 = "invalid-forced-probe";
// Remove other slots so the chain has exactly one candidate.
for (let slot = 2; slot <= 8; slot += 1) delete process.env[`GEMINI_API_KEY_${slot}`];

const { GEMINI_OPENAI_BASE_URL, createGeminiFailoverFetch } = await import("../../lib/ai/gemini-router.ts");
const { getGeminiProviders } = await import("../../lib/ai/gemini-config.ts");

console.log("providers:", getGeminiProviders().length);

const url = new URL("chat/completions", GEMINI_OPENAI_BASE_URL).toString();
const init = {
  method: "POST",
  headers: { "content-type": "application/json", Authorization: "Bearer placeholder" },
  body: JSON.stringify({
    model: process.env.GEMINI_MODEL,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 16,
  }),
};

/* --- Raw fetch (no router) ---------------------------------------------- */
const raw = await fetch(url, { ...init, headers: { ...init.headers, Authorization: "Bearer invalid-forced-probe" } });
console.log("RAW STATUS:", raw.status);
const rawBody = await raw.text();
console.log("RAW BODY:", rawBody.slice(0, 200));
console.log("REGEX MATCH:", /\bapi[\s_-]?key\b/i.test(rawBody));

/* --- Through the router --------------------------------------------------- */
const routed = createGeminiFailoverFetch();
try {
  const response = await routed(url, init);
  console.log("ROUTER RETURNED STATUS:", response.status);
} catch (error) {
  console.log("ROUTER THREW:", error?.name, error?.message);
}
