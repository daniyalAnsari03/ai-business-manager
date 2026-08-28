/**
 * QA conversation driver — drives REAL multi-turn conversations through the
 * running /api/ai/chat endpoint using the REAL account session, preserving the
 * server-returned conversationId so disambiguation carry-forward state is
 * exercised across turns (docs/fix.txt).
 *
 * Usage:
 *   node --env-file=.env.local tests/qa/conv-driver.mjs [--base URL] "msg1" "msg2" ...
 *
 *   Each argument is one user turn in the SAME conversation (conversationId is
 *   threaded through). Prints every SSE event per turn. Exits non-zero if any
 *   turn ends in an error event.
 *
 * Credentials come from QA_EMAIL / QA_PASSWORD env vars.
 */
import process from "node:process";

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
const BASE_URL = argValue("--base") ?? "http://localhost:3000";
const START_CONVERSATION = argValue("--conversation");
// Take everything after any --flags out.
const flagIndexes = new Set();
args.forEach((a, i) => {
  if (a.startsWith("--")) {
    flagIndexes.add(i);
    flagIndexes.add(i + 1);
  }
});
const turns = args.filter((_, i) => !flagIndexes.has(i));

const EMAIL = process.env.QA_EMAIL;
const PASSWORD = process.env.QA_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("QA_EMAIL and QA_PASSWORD are required.");
  process.exit(2);
}
if (turns.length === 0) {
  console.error("Provide at least one message turn argument.");
  process.exit(2);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase public env vars (.env.local).");
  process.exit(2);
}
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
  if (!res.ok) {
    throw new Error(`Sign-in failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

async function postChat(cookieValue, body) {
  return fetch(`${BASE_URL}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `${cookieName}=${cookieValue}` },
    body: JSON.stringify(body),
  });
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
        try {
          events.push(JSON.parse(payload));
        } catch {
          events.push({ type: "unparsed", raw: payload });
        }
      }
    }
  }
  return events;
}

const session = await signIn();
console.log(`[conv-driver] signed in user=${session.user.id}`);
const sessionJson = JSON.stringify({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  token_type: session.token_type ?? "bearer",
  expires_in: session.expires_in ?? 3600,
  expires_at: session.expires_at,
  user: session.user,
});
const cookieValue = `base64-${base64url(sessionJson)}`;

let conversationId = START_CONVERSATION;
let finalOk = true;
for (let i = 0; i < turns.length; i += 1) {
  const message = turns[i];
  console.log(`\n=== TURN ${i + 1}/${turns.length}: ${JSON.stringify(message)} ===`);
  const body = { message, language: "ur", history: [] };
  if (conversationId) body.conversationId = conversationId;

  const res = await postChat(cookieValue, body);
  console.log(`POST /api/ai/chat -> HTTP ${res.status}`);
  if (!res.ok) {
    console.error(await res.text());
    process.exit(1);
  }
  const events = await readSse(res);

  let sawError = false;
  let doneText = "";
  for (const e of events) {
    if (e.type === "action") {
      console.log(`  action : ${e.action?.code} ${e.action?.phase} ${JSON.stringify(e.action?.params ?? {})}`);
    } else if (e.type === "status") {
      console.log(`  status : ${e.phase}`);
    } else if (e.type === "error") {
      console.log(`  ERROR  : ${e.code}`);
      sawError = true;
    } else if (e.type === "text_delta") {
      process.stdout.write(e.delta);
    } else if (e.type === "done") {
      doneText = e.text ?? "";
      conversationId = e.conversationId ?? conversationId;
      console.log(`\n  DONE text: ${doneText.slice(0, 800)}`);
      console.log(`  DONE conversationId: ${conversationId}`);
    } else {
      console.log(`  ${e.type}: ${JSON.stringify(e).slice(0, 300)}`);
    }
  }
  if (sawError) finalOk = false;
}

console.log(`\n[conv-driver] final conversationId=${conversationId}`);
console.log(finalOk ? "[conv-driver] all turns OK" : "[conv-driver] at least one turn errored");
if (!finalOk) process.exit(1);
