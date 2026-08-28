import process from "node:process";

const EMAIL = process.env.QA_EMAIL;
const PASSWORD = process.env.QA_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("QA_EMAIL and QA_PASSWORD are required.");
  process.exit(2);
}
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
const headers = {
  apikey: supabaseKey,
  Authorization: `Bearer ${session.access_token}`,
  "Content-Type": "application/json",
};

const res = await fetch(
  `${supabaseUrl}/rest/v1/ai_conversations?id=eq.${convId}&select=id,pending_disambiguation,updated_at`,
  { headers },
);
console.log("status", res.status);
console.log(JSON.stringify(await res.json(), null, 2));
