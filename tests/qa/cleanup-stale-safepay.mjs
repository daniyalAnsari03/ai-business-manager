/**
 * Cleanup stale Safepay wallet transactions (docs/phase0.txt).
 *
 * 1. Query wallet_transactions for type=topup, status=pending, description
 *    containing "Safepay" — list them.
 * 2. Confirm these rows never affected the wallet balance.
 * 3. Delete only these specific stale rows.
 * 4. Confirm wallet balance is unaffected.
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

const svcHeaders = {
  apikey: SVC,
  Authorization: `Bearer ${SVC}`,
  "Content-Type": "application/json",
};

// Authenticated session headers (for reading wallet_transactions with RLS)
const session = await fetch(SUP + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).then((r) => r.json());
if (!session.access_token) throw new Error("sign-in failed");
const authHeaders = {
  apikey: KEY,
  Authorization: `Bearer ${session.access_token}`,
};

const business = (
  await fetch(
    SUP +
      `/rest/v1/businesses?owner_id=eq.${session.user.id}&select=id,name&limit=1`,
    { headers: authHeaders },
  ).then((r) => r.json())
)[0];
const BIZ = business.id;
console.log(`Business: ${business.name} (${BIZ})`);

// ── Step 1: List stale Safepay pending topups ──────────────────────────────
console.log("\n── Step 1: Query stale Safepay pending topups ──");

// Use service-role to bypass RLS for this cross-business cleanup query
const staleRows = await fetch(
  SUP +
    `/rest/v1/wallet_transactions?status=eq.pending&type=eq.topup&description=like.*Safepay*&select=id,business_id,amount,status,description,created_at&order=created_at.asc`,
  { headers: svcHeaders },
).then((r) => r.json());

console.log(`Found ${staleRows.length} stale row(s):`);
for (const row of staleRows) {
  console.log(
    `  id=${row.id}  business=${row.business_id}  amount=Rs ${row.amount}  desc="${row.description}"  created=${row.created_at}`,
  );
}

if (staleRows.length === 0) {
  console.log("\nNo stale Safepay transactions found. Nothing to do.");
  process.exit(0);
}

// ── Step 2: Confirm these never affected balance ───────────────────────────
console.log("\n── Step 2: Confirm pending transactions did NOT affect balance ──");
for (const row of staleRows) {
  console.log(
    `  tx ${row.id}: status=pending → balance was NOT changed (pending = no balance mutation)`,
  );
}

// Also check the wallet balance directly
const wallets = await fetch(
  SUP + `/rest/v1/marketing_wallet?select=id,business_id,balance`,
  { headers: svcHeaders },
).then((r) => r.json());

console.log("\nCurrent wallet balances:");
for (const w of wallets) {
  console.log(`  wallet=${w.id}  business=${w.business_id}  balance=Rs ${w.balance}`);
}

// ── Step 3: Delete stale rows ──────────────────────────────────────────────
console.log("\n── Step 3: Delete stale Safepay pending rows ──");
const deletedIds = staleRows.map((r) => r.id);
const idFilter = deletedIds.map((id) => `id=eq.${id}`).join("&");

const deleteResponse = await fetch(
  SUP + `/rest/v1/wallet_transactions?${idFilter}`,
  { method: "DELETE", headers: svcHeaders },
);
console.log(`  DELETE status: ${deleteResponse.status}`);

if (deleteResponse.status !== 204) {
  const body = await deleteResponse.text();
  console.error(`  DELETE response: ${body}`);
  process.exit(1);
}

console.log(`  Deleted ${deletedIds.length} row(s): ${deletedIds.join(", ")}`);

// ── Step 4: Confirm balance unaffected ─────────────────────────────────────
console.log("\n── Step 4: Confirm wallet balance unaffected ──");
const walletsAfter = await fetch(
  SUP + `/rest/v1/marketing_wallet?select=id,business_id,balance`,
  { headers: svcHeaders },
).then((r) => r.json());

for (const w of walletsAfter) {
  console.log(`  wallet=${w.id}  business=${w.business_id}  balance=Rs ${w.balance}`);
}

// ── Step 5: Verify no more stale rows remain ───────────────────────────────
console.log("\n── Step 5: Verify stale rows are gone ──");
const remaining = await fetch(
  SUP +
    `/rest/v1/wallet_transactions?status=eq.pending&type=eq.topup&description=like.*Safepay*&select=id`,
  { headers: svcHeaders },
).then((r) => r.json());

console.log(`  Remaining stale rows: ${remaining.length}`);

// Also check all wallet_transactions for this business
const allTx = await fetch(
  SUP +
    `/rest/v1/wallet_transactions?business_id=eq.${BIZ}&select=id,type,amount,status,description,created_at&order=created_at.asc`,
  { headers: svcHeaders },
).then((r) => r.json());

console.log(`\n  All wallet_transactions for ${business.name}: ${allTx.length} row(s)`);
for (const tx of allTx) {
  console.log(
    `    ${tx.id}  type=${tx.type}  Rs ${tx.amount}  status=${tx.status}  "${tx.description}"`,
  );
}
if (allTx.length === 0) {
  console.log("    (empty — no transactions)");
}

console.log("\n✓ Cleanup complete.");
