/**
 * Phase 0 — FINAL FIX. Delete the 4 stale Safepay rows by exact ID,
 * one at a time, and immediately re-query each to prove deletion.
 *
 * ROOT CAUSE: The previous deletion script used a combined OR filter
 * (`id=eq.X|id=eq.Y|...`) which may not have matched correctly in
 * PostgREST. This script deletes ONE row at a time and verifies.
 */
import fs from "node:fs";
import path from "node:path";

const envRaw = fs.readFileSync(path.resolve(".env.local"), "utf8");
const gv = (k, p = k + "=") => {
  const l = envRaw.split(/\r?\n/).find((x) => x.startsWith(p));
  return l ? l.slice(p.length).trim() : "";
};
const SUP = gv("NEXT_PUBLIC_SUPABASE_URL");
const SVC = gv("SUPABASE_SERVICE_ROLE_KEY");

const svcHeaders = {
  apikey: SVC,
  Authorization: `Bearer ${SVC}`,
  "Content-Type": "application/json",
};

const STALE_IDS = [
  "7e94b655-03f1-4000-b58c-74da30e415e4",
  "a75b9008-e3c4-4fbe-bf35-3738426271a2",
  "656fd68d-99b5-4ff5-943a-33ecc2b36e94",
  "639b4acf-ae21-45b2-bb84-da3b41633ecd",
];

const BIZ = "338f48b5-74ed-4f0b-8754-208c6fe663b5";

// ── STEP 1: Prove the rows exist RIGHT NOW ────────────────────────────────
console.log("══════════════════════════════════════════════════════════════");
console.log("STEP 1: Current state — prove rows exist before deletion");
console.log("══════════════════════════════════════════════════════════════");

for (const id of STALE_IDS) {
  const row = await fetch(
    SUP + `/rest/v1/wallet_transactions?id=eq.${id}&select=id,business_id,amount,status,description,created_at`,
    { headers: svcHeaders },
  ).then((r) => r.json());
  if (row.length > 0) {
    console.log(`  ✓ EXISTS: ${id}  Rs ${row[0].amount}  "${row[0].description}"`);
  } else {
    console.log(`  ✗ NOT FOUND: ${id}`);
  }
}

// ── STEP 2: Delete each row ONE AT A TIME and verify ──────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log("STEP 2: Delete each row individually + immediate re-query proof");
console.log("══════════════════════════════════════════════════════════════");

let allDeleted = true;

for (const id of STALE_IDS) {
  console.log(`\n  Deleting ${id}...`);

  // Delete by exact ID
  const delRes = await fetch(
    SUP + `/rest/v1/wallet_transactions?id=eq.${id}`,
    { method: "DELETE", headers: svcHeaders },
  );
  console.log(`    DELETE status: ${delRes.status}`);

  // Immediately re-query to prove it's gone
  const check = await fetch(
    SUP + `/rest/v1/wallet_transactions?id=eq.${id}&select=id`,
    { headers: svcHeaders },
  ).then((r) => r.json());

  if (check.length === 0) {
    console.log(`    ✓ CONFIRMED DELETED — re-query returns 0 rows`);
  } else {
    console.log(`    ✗ STILL EXISTS — re-query returned: ${JSON.stringify(check)}`);
    allDeleted = false;
  }
}

// ── STEP 3: Final verification — query ALL wallet_transactions for this business ──
console.log("\n══════════════════════════════════════════════════════════════");
console.log("STEP 3: Final state — all wallet_transactions for business");
console.log("══════════════════════════════════════════════════════════════");

const remaining = await fetch(
  SUP +
    `/rest/v1/wallet_transactions?business_id=eq.${BIZ}&select=id,type,amount,status,description,created_at&order=created_at.asc`,
  { headers: svcHeaders },
).then((r) => r.json());

console.log(`  Total rows for business ${BIZ}: ${remaining.length}`);
for (const row of remaining) {
  console.log(`    ${row.id}  Rs ${row.amount}  "${row.description}"  status=${row.status}`);
}
if (remaining.length === 0) {
  console.log("    (empty — no transactions)");
}

// ── STEP 4: Search for ANY "Safepay" across ALL businesses ────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log("STEP 4: Verify NO 'Safepay' rows exist ANYWHERE");
console.log("══════════════════════════════════════════════════════════════");

const anySafepay = await fetch(
  SUP +
    `/rest/v1/wallet_transactions?description=like.*Safepay*&select=id,business_id,amount,description`,
  { headers: svcHeaders },
).then((r) => r.json());

console.log(`  Rows with "Safepay" anywhere: ${anySafepay.length}`);
for (const row of anySafepay) {
  console.log(`    ${row.id}  biz=${row.business_id}  Rs ${row.amount}  "${row.description}"`);
}

// ── STEP 5: Wallet balance for this business ──────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log("STEP 5: marketing_wallet balance for this business");
console.log("══════════════════════════════════════════════════════════════");

const wallet = await fetch(
  SUP + `/rest/v1/marketing_wallet?business_id=eq.${BIZ}&select=id,balance`,
  { headers: svcHeaders },
).then((r) => r.json());

if (wallet.length > 0) {
  console.log(`  wallet=${wallet[0].id}  balance=Rs ${wallet[0].balance}`);
} else {
  console.log("  (no wallet row for this business)");
}

// ── SUMMARY ────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log(allDeleted ? "✓ ALL 4 STALE ROWS DELETED AND VERIFIED" : "✗ SOME DELETIONS FAILED — SEE ABOVE");
console.log("══════════════════════════════════════════════════════════════");
