import process from "node:process";
import fs from "node:fs";

const EMAIL = process.env.QA_EMAIL;
const PASSWORD = process.env.QA_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("QA_EMAIL and QA_PASSWORD are required.");
  process.exit(2);
}

const BASE_URL = process.env.QA_BASE_URL ?? "http://localhost:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const cookieName = `sb-${projectRef}-auth-token`;

function base64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

async function signIn() {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Sign-in failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function readSse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") continue;
        try { events.push(JSON.parse(payload)); } catch {}
      }
    }
  }
  return events;
}

const session = await signIn();
const sessionJson = JSON.stringify({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  token_type: session.token_type ?? "bearer",
  expires_in: session.expires_in ?? 3600,
  expires_at: session.expires_at,
  user: session.user,
});
const cookieValue = `base64-${base64url(sessionJson)}`;
const headers = { Cookie: `${cookieName}=${cookieValue}` };

const imagePath = process.argv[2];
const userMessage = process.argv[3] ?? "Is image se ek naya product banao: name 'QA Image Kurta', category 'Apparel', price 250, stock 8";
if (!imagePath) {
  console.error("Usage: node tests/qa/image-test.mjs <image-path> [\"user message\"]");
  process.exit(2);
}

const form = new FormData();
form.append("file", new Blob([fs.readFileSync(imagePath)], { type: "image/png" }), "photo.png");
const upRes = await fetch(`${BASE_URL}/api/ai/upload`, { method: "POST", headers, body: form });
console.log("upload status", upRes.status);
if (upRes.status !== 200) {
  console.error(await upRes.text());
  process.exit(1);
}
const { url } = await upRes.json();
console.log("uploaded url:", url);

const chatRes = await fetch(`${BASE_URL}/api/ai/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify({ message: userMessage, language: "ur", history: [], imageUrl: url }),
});
console.log("chat status", chatRes.status);
const events = await readSse(chatRes);
for (const e of events) {
  if (e.type === "action") console.log(`  action : ${e.action?.code} ${e.action?.phase} ${JSON.stringify(e.action?.params ?? {})}`);
  else if (e.type === "status") console.log(`  status : ${e.phase}`);
  else if (e.type === "error") console.log(`  ERROR  : ${e.code}`);
  else if (e.type === "text_delta") process.stdout.write(e.delta);
  else if (e.type === "done") {
    console.log(`\n  DONE: ${e.text}`);
    console.log(`  conversationId: ${e.conversationId}`);
  }
}
