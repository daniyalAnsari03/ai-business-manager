/**
 * Isolated check: what do the REAL tool schemas look like after SDK
 * conversion, and does the Groq boundary sanitizer patch them?
 * No network calls.
 */

process.env.GEMINI_API_KEY_1 = "k";
process.env.GROQ_API_KEY = "grq-dummy";

const { businessTools } = await import("../../lib/ai/tools/index.ts");

const emptyish = businessTools.filter((t) => {
  const p = t.parameters;
  return p && typeof p === "object" && !("properties" in p);
});

console.log(`total tools: ${businessTools.length}`);
for (const tool of businessTools.slice(0, 30)) {
  const params = tool.parameters;
  const hasProps = params && typeof params === "object" && "properties" in params;
  console.log(
    `${tool.name}: type=${tool.type} strict=${tool.strict} hasProperties=${hasProps}`,
  );
}

if (emptyish.length > 0) {
  console.log("\nSCHEMA WITHOUT PROPERTIES:");
  console.log(JSON.stringify(emptyish[0].parameters, null, 2));
}
