/**
 * Phase-1 verification (docs/fix.txt item 4):
 * Inspect the four marketing tables in Supabase and prove RLS is enforced.
 *
 * What this proves from the live project (no DB-over-SQL access is available,
 * only the public REST API + a real authenticated user):
 *   - tables exist (PostgREST 200, not 404/PGRST205)
 *   - table-level grants + RLS are active: anonymous INSERT is rejected with
 *     code 42501 (violates row-level security) even though anon holds INSERT
 *     grants — the owner-scoped WITH CHECK blocks it.
 *   - the authenticated owner can read their own (currently empty) rows.
 *
 * The applied policy DEFINITIONS come from the committed migration
 *   supabase/migrations/20260828140000_create_marketing_tables.sql
 * and are printed here for the record.
 *
 * Run:
 *   node tests/qa/marketing-rls-verify.mjs
 */
import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(".env.local");
const envRaw = fs.readFileSync(envPath, "utf8");

function envValue(key, prefix = key + "=") {
  const line = envRaw
    .split(/\r?\n/)
    .find((l) => l.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : "";
}

const supabaseUrl = envValue("NEXT_PUBLIC_SUPABASE_URL");
const supabaseKey = envValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const email = envValue("email:", "email: ");
const password = envValue("password:", "password: ");

if (!supabaseUrl || !supabaseKey || !email || !password) {
  console.error("Missing Supabase URL/key/test credentials in .env.local.");
  process.exit(2);
}

const TABLES = {
  social_posts: { business_id: "<uuid>", platform: "instagram" },
  ad_campaigns: { business_id: "<uuid>", platform: "instagram" },
  marketing_wallet: { business_id: "<uuid>", balance: 0 },
  connected_accounts: { business_id: "<uuid>", platform: "whatsapp" },
};

async function signIn() {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`Sign-in failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

function authHeaders(token) {
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function anonHeaders() {
  return { apikey: supabaseKey, "Content-Type": "application/json" };
}

const session = await signIn();
console.log(`[rls] authenticated as user ${session.user.id}`);

const busRes = await fetch(
  `${supabaseUrl}/rest/v1/businesses?owner_id=eq.${session.user.id}&select=id,name,language&limit=1`,
  { headers: authHeaders(session.access_token) },
);
if (!busRes.ok) throw new Error(`business lookup failed ${busRes.status}`);
const business = (await busRes.json())[0];
if (!business) throw new Error("No business found for this account.");
console.log(`[rls] business id=${business.id} name=${business.name} language=${business.language}`);

const results = {};
for (const table of Object.keys(TABLES)) {
  const row = { ...TABLES[table], business_id: business.id };

  // 1) Table exists + readable by the owner (returns 200 even if empty).
  const ownerRes = await fetch(
    `${supabaseUrl}/rest/v1/${table}?select=*&business_id=eq.${business.id}&limit=1`,
    { headers: authHeaders(session.access_token) },
  );
  const ownerBody = await ownerRes.text();

  // 2) Anonymous INSERT (no user JWT; anon role holds table grants from
  //    the privileges migration). If RLS were off, this would succeed.
  const anonRes = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: anonHeaders(),
    body: JSON.stringify(row),
  });
  const anonBody = await anonRes.text();

  results[table] = {
    tableExists: ownerRes.status === 200 && !/PGRST205|PGRST301/.test(ownerBody),
    ownerRowsReadable: ownerRes.status === 200,
    ownerReadReturned: /^\[/s.test(ownerBody),
    anonInsertStatus: anonRes.status,
    anonInsertBody: anonBody.slice(0, 300),
    anonRejectedByRls: /42501|row-level security|violates row-level security/i.test(anonBody),
  };
}

console.log("\n=== LIVE TABLE / RLS PROBE RESULTS ===");
for (const [table, r] of Object.entries(results)) {
  console.log(`\n-- ${table} --`);
  console.log(`  table exists (owner SELECT OK) : ${r.tableExists}`);
  console.log(`  owner read status/body          : HTTP ${r.ownerReadReturned ? "array returned" : "non-array"}, rows: ${r.ownerReadReturned ? "readable" : "not readable"}`);
  console.log(`  anonymous INSERT → HTTP ${r.anonInsertStatus}${r.anonRejectedByRls ? " (RLS REJECTED ✓)" : ""}`);
  console.log(`  anon response: ${r.anonInsertBody}`);
}

console.log("\n=== APPLIED POLICY DEFINITIONS (from migration 20260828140000) ===");
console.log(fs.readFileSync(
  path.resolve("supabase/migrations/20260828140000_create_marketing_tables.sql"),
  "utf8",
).split("\n").filter((l) => /^\s*create policy|^\s*alter table public\./i.test(l)).join("\n"));