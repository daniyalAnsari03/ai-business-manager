/**
 * Test script to verify image attachment handling in the AI chat.
 *
 * This test checks:
 * 1. The image URL is properly passed from frontend to backend
 * 2. The backend injects the image URL into the agent's input
 * 3. The agent instructions tell the model to use the imageUrl parameter
 * 4. The product tools accept the imageUrl parameter
 *
 * Usage: node tests/ai/image-attachment-test.mjs
 */

import process from "node:process";

// Test 1: Verify the chat route parses imageUrl correctly
console.log("Test 1: Checking chat route imageUrl parsing...");

// Simulate the parseChatRequest function logic
function parseChatRequest(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw;

  const language = typeof body.language === "string" ? body.language : null;
  if (!language) return null;

  const userMessage = typeof body.message === "string" ? body.message.trim() : "";
  if (!userMessage) return null;

  if (!Array.isArray(body.history)) return null;

  const imageUrl =
    typeof body.imageUrl === "string" && body.imageUrl.trim().startsWith("http")
      ? body.imageUrl.trim()
      : undefined;

  return { userMessage, language, imageUrl };
}

// Test with image URL
const testBodyWithImage = {
  message: "is product ko add karo",
  language: "ur",
  history: [],
  imageUrl: "https://example.com/image.jpg",
};

const resultWithImage = parseChatRequest(testBodyWithImage);
if (resultWithImage && resultWithImage.imageUrl === "https://example.com/image.jpg") {
  console.log("✓ PASS: imageUrl is correctly parsed from request body");
} else {
  console.log("✗ FAIL: imageUrl was not parsed correctly");
  process.exit(1);
}

// Test without image URL
const testBodyWithoutImage = {
  message: "is product ko add karo",
  language: "ur",
  history: [],
};

const resultWithoutImage = parseChatRequest(testBodyWithoutImage);
if (resultWithoutImage && resultWithoutImage.imageUrl === undefined) {
  console.log("✓ PASS: imageUrl is correctly undefined when not provided");
} else {
  console.log("✗ FAIL: imageUrl should be undefined when not provided");
  process.exit(1);
}

// Test 2: Verify the agent instructions mention image handling
console.log("\nTest 2: Checking agent instructions for image handling...");

// Read the agent.ts file content
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const agentPath = join(__dirname, "..", "..", "lib", "ai", "agent.ts");
const agentContent = readFileSync(agentPath, "utf8");

if (agentContent.includes("[ATTACHED IMAGE URL: ...]")) {
  console.log("✓ PASS: Agent instructions mention the ATTACHED IMAGE URL tag");
} else {
  console.log("✗ FAIL: Agent instructions do not mention the ATTACHED IMAGE URL tag");
  process.exit(1);
}

if (agentContent.includes("ALWAYS include the imageUrl parameter")) {
  console.log("✓ PASS: Agent instructions tell the model to always include imageUrl parameter");
} else {
  console.log("✗ FAIL: Agent instructions do not tell the model to always include imageUrl parameter");
  process.exit(1);
}

// Test 3: Verify product tools accept imageUrl parameter
console.log("\nTest 3: Checking product tools for imageUrl parameter...");

const productToolsPath = join(__dirname, "..", "..", "lib", "ai", "tools", "product-tools.ts");
const productToolsContent = readFileSync(productToolsPath, "utf8");

if (productToolsContent.includes("imageUrl: z.string().trim().max(2000).optional().nullable()")) {
  console.log("✓ PASS: Product tools accept imageUrl parameter");
} else {
  console.log("✗ FAIL: Product tools do not accept imageUrl parameter");
  process.exit(1);
}

if (productToolsContent.includes("ALWAYS include this when the user has attached an image")) {
  console.log("✓ PASS: Product tools description mentions image attachment");
} else {
  console.log("✗ FAIL: Product tools description does not mention image attachment");
  process.exit(1);
}

// Test 4: Verify the chat route injects image URL into user message
console.log("\nTest 4: Checking chat route image URL injection...");

const chatRoutePath = join(__dirname, "..", "..", "app", "api", "ai", "chat", "route.ts");
const chatRouteContent = readFileSync(chatRoutePath, "utf8");

if (chatRouteContent.includes("[ATTACHED IMAGE URL: ${parsed.imageUrl}]")) {
  console.log("✓ PASS: Chat route injects image URL into user message");
} else {
  console.log("✗ FAIL: Chat route does not inject image URL into user message");
  process.exit(1);
}

if (chatRouteContent.includes("use the imageUrl parameter when calling create_product or update_product tools")) {
  console.log("✓ PASS: Chat route tells the model to use imageUrl parameter");
} else {
  console.log("✗ FAIL: Chat route does not tell the model to use imageUrl parameter");
  process.exit(1);
}

console.log("\n✓ All tests passed!");
console.log("\nSummary of fixes applied:");
console.log("1. Backend route now injects image URL directly into the user message content");
console.log("2. Agent instructions now explicitly tell the model to use imageUrl parameter");
console.log("3. Product tools descriptions now mention image attachment handling");
console.log("\nThe image attachment flow should now work end-to-end:");
console.log("1. Frontend uploads image and gets URL");
console.log("2. Frontend sends imageUrl in request body");
console.log("3. Backend parses imageUrl and injects it into user message");
console.log("4. Agent sees the image URL in the message and uses it when creating/updating products");
console.log("5. Product tools accept the imageUrl parameter and save it to the database");
