/**
 * Phase 0 — FULL INVESTIGATION with complete skepticism.
 *
 * Does NOT assume anything. Queries raw data, finds the real business,
 * checks for stale rows across ALL businesses, and only then acts.
 */
import fs from "node:fs";
import path from "node:path";

const envRaw = fs.readFileSync(path.resolve(".env.local"), "utf8");
const gv = (k, p = k + "=") => {
  const l = envRaw.split(/\r?\n/).find((x) => x.startsWith(p));
  return l ? l.slice(p.length).trim() : "";
};
const EMAIL = gv("email:", "email: ");
const PASSWORD = gv("password:", "password: ");
const SUP = gv("NEXT_PUBLIC_SUPABASE_URL");
const KEY = gv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SVC = gv("SUPABASE_SERVICE_ROLE_KEY");

console.log("Supabase URL:", SUP);
console.log("Service key prefix:", SVC.slice(0, 20) + "...");

// ── Authenticate ───────────────────────────────────────────────────────────
const session = await fetch(SUP + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).then((r) => r.json());
if (!session.access_token) {
  console.error("SIGN-IN FAILED:", JSON.stringify(session));
  process.exit(1);
}
console.log("\nAuthenticated as user:", session.user.id);

// ── Find the REAL business for this user ───────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log("STEP 1: Find the REAL business_id from the authenticated session");
console.log("══════════════════════════════════════════════════════════════");

const authHeaders = {
  apikey: KEY,
  Authorization: `Bearer ${session.access_token}`,
};
const svcHeaders = {
  apikey: SVC,
  Authorization: `Bearer ${SVC}`,
  "Content-Type": "application/json",
};

// Query businesses owned by this user via authenticated client (RLS-scoped)
const myBusinesses = await fetch(
  SUP + `/rest/v1/businesses?owner_id=eq.${session.user.id}&select=id,name,created_at`,
  { headers: authHeaders },
).then((r) => r.json());

console.log("\nBusinesses owned by this user (via authenticated RLS query):");
for (const b of myBusinesses) {
  console.log(`  id=${b.id}  name="${b.name}"  created=${b.created_at}`);
}
console.log(`  Total: ${myBusinesses.length}`);

const REAL_BIZ = myBusinesses[0]?.id;
if (!REAL_BIZ) {
  console.error("NO BUSINESS FOUND for this user!");
  process.exit(1);
}
console.log(`\n→ REAL business_id: ${REAL_BIZ}`);

// ── Check the OLD business_id too ──────────────────────────────────────────
const OLD_BIZ = "338f48b5-74ed-4f0b-8754-208c6fe663b5";
console.log(`\nPreviously assumed business_id: ${OLD_BIZ}`);
console.log(`Match: ${REAL_BIZ === OLD_BIZ ? "YES (same)" : "NO — MISMATCH!"}`);

// ── Query ALL businesses via service-role (admin view) ─────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log("STEP 2: List ALL businesses in the database (admin view)");
console.log("══════════════════════════════════════════════════════════════");

const allBusinesses = await fetch(
  SUP + `/rest/v1/businesses?select=id,name,owner_id,created_at&order=created_at.asc`,
  { headers: svcHeaders },
).then((r) => r.json());

for (const b of allBusinesses) {
  const isMine = b.id === REAL_BIZ ? " ◄── THIS IS YOUR BUSINESS" : "";
  const isOld = b.id === OLD_BIZ ? " ◄── OLD ASSUMED" : "";
  console.log(
    `  id=${b.id}  name="${b.name}"  owner=${b.owner_id}${isMine}${isOld}`,
  );
}
console.log(`  Total businesses: ${allBusinesses.length}`);

// ── Query wallet_transactions for BOTH business IDs ────────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log("STEP 3: Query wallet_transactions for BOTH business IDs");
console.log("══════════════════════════════════════════════════════════════");

for (const bizId of [REAL_BIZ, OLD_BIZ]) {
  const label = bizId === REAL_BIZ ? "REAL" : "OLD";
  console.log(`\n--- ${label} business: ${bizId} ---`);

  const rows = await fetch(
    SUP +
      `/rest/v1/wallet_transactions?business_id=eq.${bizId}&select=id,business_id,type,amount,status,description,created_at&order=created_at.asc`,
    { headers: svcHeaders },
  ).then((r) => r.json());

  console.log(`  Row count: ${rows.length}`);
  for (const row of rows) {
    console.log(
      `  id=${row.id}  type=${row.type}  Rs ${row.amount}  status=${row.status}  "${row.description}"  created=${row.created_at}`,
    );
  }
}

// ── Query wallet_transactions with NO filter (find ALL stale rows) ─────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log("STEP 4: Query ALL wallet_transactions across ALL businesses");
console.log("══════════════════════════════════════════════════════════════");

const allTx = await fetch(
  SUP +
    `/rest/v1/wallet_transactions?select=id,business_id,type,amount,status,description,created_at&order=created_at.asc`,
  { headers: svcHeaders },
).then((r) => r.json());

console.log(`  Total rows across all businesses: ${allTx.length}`);
for (const row of allTx) {
  console.log(
    `  id=${row.id}  biz=${row.business_id}  type=${row.type}  Rs ${row.amount}  status=${row.status}  "${row.description}"  created=${row.created_at}`,
  );
}

// ── Specifically search for "Safepay" in descriptions ──────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log("STEP 5: Search for ANY 'Safepay' in wallet_transactions descriptions");
console.log("══════════════════════════════════════════════════════════════");

const safepayRows = await fetch(
  SUP +
    `/rest/v1/wallet_transactions?description=like.*Safepay*&select=id,business_id,type,amount,status,description,created_at&order=created_at.asc`,
  { headers: svcHeaders },
).then((r) => r.json());

console.log(`  Rows with "Safepay" in description: ${safepayRows.length}`);
for (const row of safepayRows) {
  console.log(
    `  id=${row.id}  biz=${row.business_id}  Rs ${row.amount}  status=${row.status}  "${row.description}"`,
  );
}

// ── Check the specific 4 IDs from the previous (failed?) deletion ──────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log("STEP 6: Check the 4 specific IDs from previous deletion attempt");
console.log("══════════════════════════════════════════════════════════════");

const oldIds = [
  "7e94b655-03f1-4000-b58c-74da30e415e4",
  "a75b9008-e3c4-4fbe-bf35-3738426271a2",
  "656fd68d-99b5-4ff5-943a-33ecc2b36e94",
  "639b4acf-ae21-45b2-bb84-da3b41633ecd",
];

for (const id of oldIds) {
  const row = await fetch(
    SUP + `/rest/v1/wallet_transactions?id=eq.${id}&select=id,business_id,type,amount,status,description,created_at`,
    { headers: svcHeaders },
  ).then((r) => r.json());
  if (row.length === 0) {
    console.log(`  ${id}: NOT FOUND (deleted or never existed)`);
  } else {
    console.log(`  ${id}: EXISTS → biz=${row[0].business_id}  Rs ${row[0].amount}  "${row[0].description}"`);
  }
}

// ── Check marketing_wallet for all businesses ──────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log("STEP 7: marketing_wallet balances for all businesses");
console.log("══════════════════════════════════════════════════════════════");

const wallets = await fetch(
  SUP + `/rest/v1/marketing_wallet?select=id,business_id,balance,created_at`,
  { headers: svcHeaders },
).then((r) => r.json());

for (const w of wallets) {
  console.log(`  wallet=${w.id}  biz=${w.business_id}  balance=Rs ${w.balance}`);
}
if (wallets.length === 0) {
  console.log("  (no wallet rows found)");
}

console.log("\n══════════════════════════════════════════════════════════════");
console.log("INVESTIGATION COMPLETE — raw data above");
console.log("══════════════════════════════════════════════════════════════");
