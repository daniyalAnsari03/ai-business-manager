/**
 * End-to-end /api/ai/chat check against a RUNNING Next.js server.
 *
 * Usage:
 *   E2E_TEST_EMAIL=... E2E_TEST_PASSWORD=... node tests/ai/e2e-chat.mjs [--base URL] [--tool]
 *
 * - Signs in through Supabase Auth (password grant).
 * - Ensures the account has a completed business setup.
 * - Crafts a real `sb-<ref>-auth-token` session cookie (@supabase/ssr format).
 * - POSTs to /api/ai/chat and prints every SSE event.
 * - Exits non-zero when the run ends in an error event (try_again etc.).
 *
 * Credentials are read from env only; nothing is ever written to disk.
 */

import process from "node:process";

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
const hasFlag = (flag) => args.includes(flag);

const BASE_URL = argValue("--base") ?? "http://localhost:3001";
const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("E2E_TEST_EMAIL and E2E_TEST_PASSWORD are required.");
  process.exit(2);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing (.env.local).");
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

function authHeaders(accessToken) {
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

/** Mirrors completeBusinessSetup: one row per owner, setup_completed=true. */
async function ensureBusinessSetup(session) {
  const uid = session.user.id;
  const listRes = await fetch(
    `${supabaseUrl}/rest/v1/businesses?owner_id=eq.${uid}&select=id,setup_completed`,
    { headers: authHeaders(session.access_token) },
  );
  if (!listRes.ok) {
    throw new Error(`business lookup failed ${listRes.status}: ${(await listRes.text()).slice(0, 200)}`);
  }
  const rows = await listRes.json();
  if (rows.length > 0 && rows[0].setup_completed) {
    console.log(`[e2e] business already set up (${rows[0].id})`);
    return;
  }
  const body = JSON.stringify({
    owner_id: uid,
    name: "E2E Diagnostics Store",
    business_type: "retail",
    currency: "PKR",
    language: "ur",
    setup_completed: true,
  });
  const upsertRes = await fetch(
    `${supabaseUrl}/rest/v1/businesses?on_conflict=owner_id`,
    {
      method: "POST",
      headers: {
        ...authHeaders(session.access_token),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body,
    },
  );
  if (!upsertRes.ok) {
    throw new Error(`business setup failed ${upsertRes.status}: ${(await upsertRes.text()).slice(0, 300)}`);
  }
  console.log("[e2e] business setup created");
}

async function postChat(cookieValue, message) {
  return fetch(`${BASE_URL}/api/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${cookieName}=${cookieValue}`,
    },
    body: JSON.stringify({ message, language: "ur", history: [] }),
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

const MESSAGE = hasFlag("--tool")
  ? "Mere products ki list batao aur total stock quantity bhi."
  : "Salam! Aaj ka din kaisa hai?";

console.log(`[e2e] base=${BASE_URL} cookie=${cookieName}`);
const session = await signIn();
console.log(`[e2e] signed in user=${session.user.id}`);
await ensureBusinessSetup(session);

const sessionJson = JSON.stringify({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  token_type: session.token_type ?? "bearer",
  expires_in: session.expires_in ?? 3600,
  expires_at: session.expires_at,
  user: session.user,
});
const cookieValue = `base64-${base64url(sessionJson)}`;

const res = await postChat(cookieValue, MESSAGE);
console.log(`[e2e] POST /api/ai/chat -> HTTP ${res.status}`);
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}

const events = await readSse(res);
for (const event of events) {
  if (event.type === "action") {
    console.log(`  action : ${event.action?.type} ${event.action?.title ?? ""}`);
  } else if (event.type === "status") {
    console.log(`  status : ${event.phase}`);
  } else if (event.type === "error") {
    console.log(`  ERROR  : ${event.code}`);
  } else {
    const text = typeof event.text === "string" ? event.text.slice(0, 400) : "";
    console.log(`  ${event.type}${text ? `: ${text}` : ""}`);
  }
}

const doneEvent = events.find((e) => e.type === "done");
const errorEvent = events.find((e) => e.type === "error");

if (!doneEvent || errorEvent) {
  console.error(`[e2e] FAIL (${errorEvent ? `error code: ${errorEvent.code}` : "no done event"})`);
  process.exit(1);
}
console.log("[e2e] PASS");
