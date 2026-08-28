import process from "node:process";

const EMAIL = process.env.QA_EMAIL;
const PASSWORD = process.env.QA_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const convId = process.argv[2];

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
const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };

const res = await fetch(
  `${supabaseUrl}/rest/v1/ai_messages?conversation_id=eq.${convId}&select=id,role,content,actions,created_at&order=created_at.asc`,
  { headers },
);
const rows = await res.json();
console.log("messages count:", rows.length);
for (const r of rows) {
  console.log(`- [${r.role}] ${JSON.stringify(r.content).slice(0, 120)} actions=${JSON.stringify(r.actions ?? []).length > 2 ? "yes" : "none"}`);
}
