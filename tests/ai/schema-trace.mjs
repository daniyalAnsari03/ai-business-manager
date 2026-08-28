process.env.GEMINI_API_KEY_1 = "k";
process.env.GROQ_API_KEY = "grq-dummy";

const { businessTools } = await import("../../lib/ai/tools/index.ts");

const tool = businessTools.find((t) => t.name === "low_stock_products");
console.log("DEFINITION parameters:");
console.log(JSON.stringify(tool.parameters, null, 2));

// Now serialize the way the runner does and run the chat-completions converter.
const { serializeTool } = await import(
  "@openai/agents-core/dist/utils/serialize.mjs"
);
const serialized = serializeTool(tool);
console.log("\nSERIALIZED parameters:");
console.log(JSON.stringify(serialized.parameters, null, 2));

const { toolToOpenAI } = await import(
  "@openai/agents-openai/dist/openaiChatCompletionsConverter.mjs"
);
const converted = toolToOpenAI(serialized);
console.log("\nCONVERTED (outgoing) function.parameters:");
console.log(JSON.stringify(converted.function.parameters, null, 2));
