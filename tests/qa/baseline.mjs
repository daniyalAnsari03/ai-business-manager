/**
 * QA baseline collector — signs into the REAL account and dumps existing
 * Products, Customers, Orders, Expenses, and AI conversations.
 *
 * Run:
 *   node --env-file=.env.local tests/qa/baseline.mjs
 *
 * Credentials: QA_EMAIL / QA_PASSWORD.
 */
import process from "node:process";

const EMAIL = process.env.QA_EMAIL;
const PASSWORD = process.env.QA_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("QA_EMAIL and QA_PASSWORD are required.");
  process.exit(2);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase public env vars (.env.local).");
  process.exit(2);
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

async function getRows(session, table, businessId) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/${table}?business_id=eq.${businessId}&select=*&order=created_at`,
    { headers: authHeaders(session.access_token) },
  );
  if (!res.ok) throw new Error(`${table} lookup failed ${res.status}: ${(await res.text()).slice(0, 240)}`);
  return res.json();
}

const session = await signIn();
console.log(`[baseline] user=${session.user.id}`);

const busRes = await fetch(
  `${supabaseUrl}/rest/v1/businesses?owner_id=eq.${session.user.id}&select=id,name,setup_completed`,
  { headers: authHeaders(session.access_token) },
);
if (!busRes.ok) throw new Error(`business lookup failed ${busRes.status}`);
const businesses = await busRes.json();
const business = businesses[0];
if (!business) {
  console.log(`[baseline] NO BUSINESS SETUP`);
  process.exit(0);
}
console.log(`[baseline] business=${business.id} name=${business.name}`);

for (const table of ["products", "customers", "orders", "expenses", "ai_conversations"]) {
  const rows = await getRows(session, table, business.id);
  console.log(`\n${table} COUNT=${rows.length}`);
  for (const r of rows) console.log("  ", JSON.stringify(r));
}
