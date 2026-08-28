/**
 * Empirical Groq schema-validation check (no business data, no side effects).
 * Sends ONLY tool-schema validation requests and records status/error class.
 */

const apiKey = (process.env.GROQ_API_KEY ?? "").trim();
const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

const cases = {
  A_empty_props_present: {
    type: "object",
    properties: {},
    additionalProperties: false,
    required: [],
  },
  B_no_properties_key: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    additionalProperties: false,
    required: [],
  },
  C_full_list_products: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      search: { anyOf: [{ type: "string", maxLength: 120 }, { type: "null" }] },
      limit: { default: 20, type: "integer", minimum: 1, maximum: 50 },
    },
    required: ["search", "limit"],
    additionalProperties: false,
  },
  D_empty_props_no_required: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  E_empty_schema: {},
  F_type_object_only: { type: "object", properties: {} },
};

for (const [name, parameters] of Object.entries(cases)) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      max_completion_tokens: 2048,
      tools: [
        {
          type: "function",
          function: {
            name: `probe_${name}`,
            description: "schema validation probe",
            parameters,
            strict: true,
          },
        },
      ],
    }),
  });
  const bodyText = await response.text();
  const short = bodyText.replace(/gsk_[A-Za-z0-9]+/g, "[redacted]").slice(0, 220);
  console.log(
    `${name}: status=${response.status} ${response.ok ? "ACCEPTED" : `REJECTED — ${short}`}`,
  );
}
