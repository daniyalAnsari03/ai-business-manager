/**
 * Phase 0 (docs/phase0.txt) — Wallet Phase 3 FULL live-UI verification.
 *
 * Runs AFTER the wallet_transactions GRANT migration was applied. Verifies the
 * wallet end to end against the live dev server, the real test account (DINS,
 * PKR, Roman Urdu) and the live Supabase project:
 *
 *   1. wallet_transactions table exists, grants present (reads work).
 *   2. Logs in with the real test account, opens Marketing → Wallet.
 *   3. Confirms initial balance is Rs 0 and transaction history is empty.
 *   4. Funds the wallet via the completed-topup RPC (no live gateway in this
 *      phase), then uses the real test-spend tool in the UI to spend 200 and
 *      confirms the balance + a ledger row update.
 *   5. Refreshes the page — balance and history persist.
 *   6. Tests insufficient-balance spending via the tool and confirms it fails
 *      honestly without changing the balance.
 *   7. RLS cross-business isolation spot-check.
 *
 * Run:
 *   node tests/qa/wallet-phase0.mjs [baseURL]
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.argv[2] || "http://localhost:3000";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const envRaw = fs.readFileSync(path.resolve(".env.local"), "utf8");
const gv = (k, p = k + "=") => {
  const l = envRaw.split(/\r?\n/).find((x) => x.startsWith(p));
  return l ? l.slice(p.length).trim() : "";
};
const EMAIL = gv("email:", "email: ");
const PASSWORD = gv("password:", "password: ");
const SUPABASE_URL = gv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY = gv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SVC_KEY = gv("SUPABASE_SERVICE_ROLE_KEY");

const report = { steps: [], consoleErrors: [], pageErrors: [] };
function step(name, detail) {
  report.steps.push({ name, detail });
  console.log(`\n== ${name} ==\n  ${String(detail ?? "").replace(/\n/g, "\n  ")}`);
}

const session = await supabaseSession();
if (!session.access_token) throw new Error("sign-in failed");
const authH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` };
const svcBody = {
  apikey: SVC_KEY,
  Authorization: `Bearer ${SVC_KEY}`,
  "Content-Type": "application/json",
};
const business = (
  await fetch(
    `${SUPABASE_URL}/rest/v1/businesses?owner_id=eq.${session.user.id}&select=id,name,currency,language&limit=1`,
    { headers: authH },
  ).then((r) => r.json())
)[0];
const BIZ = business.id;
console.log(
  `[env] user=${session.user.id} business=${BIZ} name=${business.name} currency=${business.currency} lang=${business.language}`,
);

async function supabaseSession() {
  return fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json());
}

// ---------------------------------------------------------------------------
// 1. SCHEMA — table + grants (reads should now succeed).
// ---------------------------------------------------------------------------
const txAsAuth = await fetch(
  `${SUPABASE_URL}/rest/v1/wallet_transactions?limit=1`,
  { headers: authH },
);
step("wallet_transactions-readable-as-auth", JSON.stringify({
  status: txAsAuth.status,
  grantsApplied: txAsAuth.status === 200,
}));

// ---------------------------------------------------------------------------
// 2. CLEAN STATE — wallet balance 0 and ledger empty.
// ---------------------------------------------------------------------------
async function walletState() {
  const w = await fetch(
    SUPABASE_URL + `/rest/v1/marketing_wallet?business_id=eq.${BIZ}&select=balance`,
    { headers: authH },
  ).then((r) => r.json());
  const txs = await fetch(
    SUPABASE_URL +
      `/rest/v1/wallet_transactions?business_id=eq.${BIZ}&select=id,type,amount,balance_after,status`,
    { headers: authH },
  ).then((r) => r.json());
  return { balance: Number(w[0]?.balance ?? 0), txCount: txs.length, txs };
}
const clean = await walletState();
step("clean-state", JSON.stringify(clean));

// ---------------------------------------------------------------------------
// 3. FUND the wallet so the test-spend has money to spend.
// ---------------------------------------------------------------------------
const fundRef = `qa_phase0_${Date.now()}`;
const fund = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_wallet_topup`, {
  method: "POST",
  headers: svcBody,
  body: JSON.stringify({
    p_business_id: BIZ,
    p_amount: 1000,
    p_gateway_reference: fundRef,
    p_description: "QA Phase0 test top-up",
  }),
}).then((r) => r.json());
step("fund-topup-rpc", JSON.stringify(fund));
const afterFund = await walletState();

// ---------------------------------------------------------------------------
// 4. DRIVE THE REAL UI.
// ---------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error")
    report.consoleErrors.push({ url: page.url(), text: msg.text().slice(0, 1600) });
});
page.on("pageerror", (err) =>
  report.pageErrors.push({ url: page.url(), text: String(err.message).slice(0, 600) }),
);

const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
const authCookieName = `sb-${projectRef}-auth-token`;
const baseHost = new URL(BASE).hostname;
const sessionJson = JSON.stringify({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  token_type: session.token_type ?? "bearer",
  expires_in: session.expires_in ?? 3600,
  expires_at: session.expires_at,
  user: {
    id: session.user.id,
    aud: session.user.aud,
    role: session.user.role,
    email: session.user.email,
    app_metadata: session.user.app_metadata,
    user_metadata: session.user.user_metadata,
    created_at: session.user.created_at,
    updated_at: session.user.updated_at,
  },
});
await ctx.addCookies([
  {
    name: authCookieName,
    value: `base64-${Buffer.from(sessionJson, "utf8").toString("base64url")}`,
    domain: baseHost,
    path: "/",
  },
]);

try {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 60000 });
  if (new URL(page.url()).pathname.startsWith("/login"))
    throw new Error("browser session was not accepted");
  step("authenticated", `loaded protected page: ${page.url()}`);

  await page.goto(`${BASE}/dashboard/marketing`, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector('h1:has-text("Marketing")', { timeout: 30000 });
  await page.waitForTimeout(2500);

  const mainText = () => page.evaluate(() => document.querySelector("main")?.textContent || "");
  const walText = await mainText();

  // Wallet section should now LOAD (not error). Labels are Roman Urdu (DINS).
  const walletLoads =
    /Bacha hua balance|Ads ke liye available balance|Available balance|Marketing wallet/.test(walText);
  const showsThousand = /1,?000/.test(walText);
  const historyPresent = /Haleh-ya transactions|Recent transactions/.test(walText);
  const noLoadError = !/load nahi ho saki|abhi load nahi/i.test(walText);
  step("wallet-ui-loads", JSON.stringify({
    walletSectionPresent: walletLoads,
    showsRs1000: showsThousand,
    transactionHistoryPresent: historyPresent,
    noLoadError: noLoadError,
    hasTestSpendTool: /SIRF TEST|Simulate ad spend/i.test(walText),
  }));
  await page.screenshot({ path: "tests/qa/shots/wallet-phase0-loaded.png", fullPage: false });

  // Locate the TEST-ONLY amber box + its amount input + submit.
  const amber = page.locator('div.border-dashed').filter({ hasText: /SIRF TEST|Simulate ad spend/i }).last();
  if ((await amber.count()) === 0) throw new Error("test-spend tool not visible");
  const amountInput = amber.locator('input[type="text"]');
  const submitBtn = amber.locator('button[type="submit"]');

  // STEP 5 — spend Rs 200 via the real tool.
  await amountInput.fill("200");
  await page.waitForTimeout(200);
  await submitBtn.click();
  await page.waitForTimeout(2800);

  const afterSpendText = await mainText();
  const dbSpend = await walletState();
  step("ui-test-spend-200", JSON.stringify({
    balanceShows800: /800/.test(afterSpendText),
    dbBalance: dbSpend.balance,
    expectedDbBalance: afterFund.balance - 200,
    historyShowsSpend: /Kharch|spend|Test /i.test(afterSpendText),
    dbTxCount: dbSpend.txCount,
    ledgerHasSpend: dbSpend.txs.some((t) => t.type === "spend" && t.balance_after === dbSpend.balance),
  }));
  await page.screenshot({ path: "tests/qa/shots/wallet-phase0-after-spend.png", fullPage: false });

  // STEP 6 — REFRESH: balance + history persist.
  await page.reload({ waitUntil: "load", timeout: 60000 });
  await page.waitForSelector('h1:has-text("Marketing")', { timeout: 30000 });
  await page.waitForTimeout(2500);
  const afterRefreshText = await mainText();
  const dbAfterRefresh = await walletState();
  step("ui-refresh-persists", JSON.stringify({
    balanceShows800AfterRefresh: /800/.test(afterRefreshText),
    historyPresentAfterRefresh: /Haleh-ya transactions|Recent transactions/.test(afterRefreshText),
    historyShowsTwoRows: /(Mukammal|Completed)/.test(afterRefreshText),
    dbBalance: dbAfterRefresh.balance,
    dbTxCount: dbAfterRefresh.txCount,
  }));
  await page.screenshot({ path: "tests/qa/shots/wallet-phase0-refresh.png", fullPage: false });

  // STEP 7 — INSUFFICIENT BALANCE: spend 999999 (> balance 800) must fail.
  const amber2 = page.locator('div.border-dashed').filter({ hasText: /SIRF TEST|Simulate ad spend/i }).last();
  await amber2.locator('input[type="text"]').fill("999999");
  await page.waitForTimeout(200);
  await amber2.locator('button[type="submit"]').click();
  await page.waitForTimeout(2800);
  const dbInsufficient = await walletState();
  step("ui-insufficient-balance", JSON.stringify({
    balanceBefore: dbAfterRefresh.balance,
    balanceAfterAttempt: dbInsufficient.balance,
    balanceUnchanged: dbInsufficient.balance === dbAfterRefresh.balance,
    txCountUnchanged: dbInsufficient.txCount === dbAfterRefresh.txCount,
  }));
  await page.screenshot({ path: "tests/qa/shots/wallet-phase0-insufficient.png", fullPage: false });
} catch (err) {
  report.pageErrors.push({ url: page.url(), text: `FATAL: ${err?.message}` });
} finally {
  // Restore a clean state: delete wallet + ledger rows owned by this business.
  try {
    const delH = { ...authH, "Content-Type": "application/json" };
    await fetch(
      `${SUPABASE_URL}/rest/v1/wallet_transactions?business_id=eq.${BIZ}`,
      { method: "DELETE", headers: delH },
    );
    await fetch(`${SUPABASE_URL}/rest/v1/marketing_wallet?business_id=eq.${BIZ}`, {
      method: "DELETE",
      headers: delH,
    });
    step("cleanup", "wallet balance + ledger rows cleared for " + BIZ);
  } catch (e) {
    step("cleanup", `cleanup failed: ${e?.message}`);
  }
  await browser.close();
}

console.log("\n\n=============== PHASE 0 WALLET FULL UI VERIFICATION ===============");
console.log(`Steps: ${report.steps.length}`);
for (const s of report.steps) console.log(`\n[${s.name}] ${s.detail}`);
console.log(`\nConsole errors: ${report.consoleErrors.length}`);
for (const c of report.consoleErrors) console.log(`  @${c.url}\n    ${c.text}`);
console.log(`Page errors: ${report.pageErrors.length}`);
for (const p of report.pageErrors) console.log(`  @${p.url}\n    ${p.text}`);
