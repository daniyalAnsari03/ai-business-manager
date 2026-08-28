import process from "node:process";
import crypto from "node:crypto";

const EMAIL = process.env.QA_EMAIL;
const PASSWORD = process.env.QA_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const base = process.env.QA_BASE ?? "http://localhost:3000";

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const projectRef = supabaseUrl.replace(/^https:\/\//, "").replace(/\..*/, "");
const cookieName = `sb-${projectRef}-auth-token`;

async function signIn() {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Sign-in failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const session = await signIn();
const cookieVal = `base64-${base64url(JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token, expires_at: Math.floor(Date.now() / 1000) + 3600 }))}`;
const headers = { Cookie: `${cookieName}=${cookieVal}` };

async function jget(label, url) {
  const res = await fetch(`${base}${url}`, { headers });
  const text = await res.text();
  console.log(`${label} -> ${res.status}`);
  try {
    const j = JSON.parse(text);
    console.log("   ", JSON.stringify(j).slice(0, 400));
  } catch {
    console.log("   body:", text.slice(0, 200));
  }
  return res;
}

// 1. List conversations (history sidebar)
const listRes = await jget("LIST /api/ai/conversations", "/api/ai/conversations");
let list;
try { list = await listRes.json(); } catch {}
const src = (list?.conversations ?? []).find((c) => c.id === "eaca7268-8af5-433b-8ad4-0d68ae218ea8");
console.log("   found monthly-expense conv in list:", !!src, "title:", src?.title);

// 2. Search conversations (sidebar search by content)
await jget('SEARCH q="Kharchay"', "/api/ai/conversations?q=" + encodeURIComponent("kharchay"));

// 3. Load a conversation by id (history reload)
await jget("LOAD conversation", "/api/ai/conversations/eaca7268-8af5-433b-8ad4-0d68ae218ea8");

// 4. DELETE messages after a message id (edit/regenerate truncation backend)
const convRes = await fetch(`${base}/api/ai/conversations/eaca7268-8af5-433b-8ad4-0d68ae218ea8`, { headers });
const conv = await convRes.json();
const userMsg = (conv.messages ?? []).find((m) => m.role === "user");
console.log("   first user message id:", userMsg?.id, "role:", userMsg?.role);
if (userMsg) {
  const dres = await fetch(`${base}/api/ai/conversations/eaca7268-8af5-433b-8ad4-0d68ae218ea8/messages`, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ afterMessageId: userMsg.id }),
  });
  console.log(`DELETE afterMessageId -> ${dres.status} ${JSON.stringify(await dres.json())}`);
  // Re-load to verify truncation: only the user's message (before) should remain.
  const re = await fetch(`${base}/api/ai/conversations/eaca7268-8af5-433b-8ad4-0d68ae218ea8`, { headers });
  const reconv = await re.json();
  console.log("   after truncation, message roles:", (reconv.messages ?? []).map((m) => m.role).join(", "));
}
