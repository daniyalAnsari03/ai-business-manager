/**
 * Phase-1 authenticated UI verification (docs/fix.txt items 5–8):
 * Real Chrome + real account against the running dev server.
 *
 * Language handling notes:
 *  - `businesses.language` is the server-side default; `LanguageProvider`
 *    ALSO honours localStorage["abm-lang"] (by design), so the script seeds
 *    both to "ur" for a deterministic baseline and switches real languages
 *    via the in-app user-menu toggle. To stay immune to dev-server
 *    Fast-Refresh full reloads, every toggle is followed by a fresh GET to
 *    the page, which is also the strongest possible persistence proof.
 *  - The account's pre-analysis language is "ur"; the script restores
 *    businesses.language="ur" and clears the localStorage override at the end.
 *
 * Run:
 *   node tests/qa/marketing-ui-verify.mjs [baseURL]
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.argv[2] || "http://localhost:3001";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SHOT_DIR = path.resolve("tests/qa/shots");
const FINAL_LANG = "ur";

fs.mkdirSync(SHOT_DIR, { recursive: true });

const envRaw = fs.readFileSync(path.resolve(".env.local"), "utf8");
const gv = (k, p = k + "=") => {
  const l = envRaw.split(/\r?\n/).find((x) => x.startsWith(p));
  return l ? l.slice(p.length).trim() : "";
};
const EMAIL = gv("email:", "email: ");
const PASSWORD = gv("password:", "password: ");
const SUPABASE_URL = gv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY = gv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

const report = { steps: [], consoleErrors: [], pageErrors: [], responses404: [] };
function step(name, detail) {
  report.steps.push({ name, detail });
  console.log(`\n== ${name} ==\n  ${String(detail ?? "").replace(/\n/g, "\n  ")}`);
}

async function supabaseSession() {
  return fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json());
}
const session = await supabaseSession();
const authH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` };
const business = (await fetch(
  `${SUPABASE_URL}/rest/v1/businesses?owner_id=eq.${session.user.id}&select=id,language&limit=1`,
  { headers: authH },
).then((r) => r.json()))[0];
const BIZ = business.id;
console.log(`[env] user=${session.user.id} business=${BIZ} preRunLanguage=${business.language} final=${FINAL_LANG}`);

async function setBusinessLanguage(lang) {
  await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${BIZ}`, {
    method: "PATCH",
    headers: { ...authH, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ language: lang }),
  });
}
async function readBusinessLanguage() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${BIZ}&select=language&limit=1`, {
    headers: authH,
  });
  return r.json();
}
async function walletCap() {
  const rows = await fetch(
    `${SUPABASE_URL}/rest/v1/marketing_wallet?business_id=eq.${BIZ}&select=monthly_budget_cap&limit=1`,
    { headers: authH },
  ).then((r) => r.json());
  return rows[0] ? rows[0].monthly_budget_cap : null;
}
async function waitForCap(expected, ms = 20000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await walletCap();
    if ((last === null ? null : Number(last)) === expected) return { ok: true, value: last };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, last };
}
async function clearWalletCap() {
  await fetch(`${SUPABASE_URL}/rest/v1/marketing_wallet?business_id=eq.${BIZ}`, {
    method: "PATCH",
    headers: { ...authH, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ monthly_budget_cap: null }),
  });
}

await setBusinessLanguage(FINAL_LANG);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on("console", (msg) => {
  if (msg.type() === "error") {
    report.consoleErrors.push({ url: page.url(), text: msg.text().slice(0, 1600) });
  }
});
page.on("pageerror", (err) =>
  report.pageErrors.push({ url: page.url(), text: String(err.message).slice(0, 600) }),
);
page.on("response", (res) => {
  if (res.status() === 404) report.responses404.push(res.url().slice(0, 220));
});

const mainText = () => page.evaluate(() => document.querySelector("main")?.textContent || "");
const safeText = async () => {
  // Wait until the marketing page's client content has COMMITTED before reading.
  // On the dev server the very first visit to a route can show a transient
  // loading/placeholder <main> (no "Marketing" text) that briefly satisfies
  // h1:has-text and then swaps to the real content as React hydrates. Retrying
  // a plain length check still captures that placeholder, so we wait for a
  // marker that only exists in the fully-rendered marketing page.
  let last = "";
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try {
      last = await mainText();
      if (last.toLowerCase().includes("activity")) return last;
    } catch {
      // Dev-server full reload raced with our read; retry on the fresh doc.
      await page.waitForSelector("main", { timeout: 30000 });
      last = "";
    }
    await page.waitForTimeout(400);
  }
  return last;
};
const pageLines = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("main h1, main h2, main h3, main p")]
      .map((el) => el.textContent?.trim() || "")
      .filter((s) => s.length > 1 && s.length < 160)
      .filter((s, i, a) => a.indexOf(s) === i),
  );
const metricValues = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("main p"))
      .map((p) => p.textContent?.trim() || "")
      .filter((s) => /^[0-9]/u.test(s) || /^Rs /u.test(s)),
  );

const gotoMarketing = async () => {
  await page.goto(`${BASE}/dashboard/marketing`, { waitUntil: "load", timeout: 120000 });
  await page.waitForSelector('h1:has-text("Marketing")', { timeout: 30000 });
  await page.waitForTimeout(600);
};
const switchLanguage = async (label) => {
  await page.locator('button[aria-controls="user-menu-panel"]').click();
  await page.locator('#user-menu-panel button[aria-pressed]', { hasText: label }).click();
  await page.waitForTimeout(2000);
};

try {
  // ---- login ---------------------------------------------------------------
  step("login", `GET ${BASE}/login`);
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120000 });
  await page.locator("#login-email").fill(EMAIL);
  await page.locator("#login-password").fill(PASSWORD);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
  await page.evaluate(() => localStorage.setItem("abm-lang", "ur"));
  step("loginfinal", `landed at ${page.url()}; localStorage abm-lang=ur; businesses.language=${FINAL_LANG}`);

  // ---- marketing page: Roman Urdu baseline ----------------------------------
  step("marketing", `GET ${BASE}/dashboard/marketing (Roman Urdu baseline)`);
  await gotoMarketing();
  const ur = (await safeText()).toLowerCase();
  const u = (s) => ur.includes(s.toLowerCase());
  {
    const checks = {
      sidebarLink: (await page.locator('nav a[href="/dashboard/marketing"]').count()) > 0,
      h1Marketing: u("Marketing"),
      subtitleUr: u("Posts aur ads ke zariye aur customers tak pahunch"),
      postsThisWeekUr: u("Is hafte ke posts"),
      adSpendUr: u("Ad ka kharcha"),
      salesFromAdsUr: u("Ads se sale"),
      automationUr: u("Automation mode") && u("Pehle pooch kar") && u("Poora auto"),
      automationNoteUr: u("Automation ki pasand aane wale update mein kaam karna shuru karegi"),
      activityEmptyUr: u("Abhi koi marketing activity nahi hai"),
      activityBodyUr: u("Jaise hi ap posts ya ad campaigns banayenge"),
      activityActionUr: u("Settings kholein"),
      metricValues: await metricValues(),
      noEnglish: !u("posts this week") && !u("ad spend"),
    };
    step("marketing-ur", JSON.stringify(checks));
    step("marketing-ur-strings", JSON.stringify(await pageLines()));
  }
  await page.screenshot({ path: path.join(SHOT_DIR, "marketing-ur.png"), fullPage: true });

  // ---- toggle to English, then verify on a fresh SSR render ----------------
  step("lang-toggle", "user menu → English (then fresh GET to prove persistence)");
  await switchLanguage("English");
  await gotoMarketing();
  const en = (await safeText()).toLowerCase();
  const e = (s) => en.includes(s);
  const enChecks = {
    postsThisWeekEn: e("posts this week"),
    adSpendEn: e("ad spend"),
    salesFromAdsEn: e("sale from ads"),
    automationEn: e("automation mode") && e("needs approval") && e("full auto"),
    activityEmptyEn: e("no marketing activity yet"),
    activityBodyEn: e("connect an account in settings"),
    activityActionEn: e("open settings"),
    urGone: !e("is hafte ke posts") && !e("ad ka kharcha"),
    metricValues: await metricValues(),
    persistedInDb: (await readBusinessLanguage())[0]?.language === "en",
  };
  step("marketing-en", JSON.stringify(enChecks));
  step("marketing-en-strings", JSON.stringify(await pageLines()));
  await page.screenshot({ path: path.join(SHOT_DIR, "marketing-en.png"), fullPage: true });

  // ---- settings → marketing -------------------------------------------------
  step("settings-marketing", `GET ${BASE}/dashboard/settings`);
  await page.goto(`${BASE}/dashboard/settings`, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector('h2:has-text("Marketing settings")', { timeout: 30000 });
  await page.waitForTimeout(500);
  const st = (await safeText()).toLowerCase();
  const settingsChecks = {
    marketingHeading: st.includes("marketing settings"),
    sectionHint: st.includes("connect your channels and set a safety limit for ad spending"),
    platforms: ["Instagram", "Facebook Page", "Google Ads", "WhatsApp number"].every((p) =>
      st.includes(p.toLowerCase()),
    ),
    notConnected: st.includes("not connected"),
    budgetLabel: st.includes("monthly ad budget cap"),
    accountsLoaded: !st.includes("couldn't load your connected accounts"),
  };
  step("settings-marketing-state", JSON.stringify(settingsChecks));
  await page.screenshot({ path: path.join(SHOT_DIR, "settings-marketing-en.png"), fullPage: true });

  // Connect button → localized coming-soon note, no crash.
  await page.getByRole("button", { name: /^Connect/i }).first().click();
  await page.waitForTimeout(600);
  const note = await safeText();
  step("connect-button", JSON.stringify({
    noteShown: /Connecting accounts is coming in an upcoming update/.test(note),
    noCrash: note.length > 0,
  }));
  await page.screenshot({ path: path.join(SHOT_DIR, "settings-connect-note.png"), fullPage: true });

  // ---- budget cap: set → persist → refresh → clear --------------------------
  const budgetForm = page.locator("form", { has: page.locator("#marketing-monthly-budget-cap") });
  const saveBtn = budgetForm.locator('button[type="submit"]');
  const input = page.locator("#marketing-monthly-budget-cap");

  step("budget-save", "enter 4321 and save");
  await input.fill("4321");
  await saveBtn.click();
  const saved = await waitForCap(4321);
  step("budget-save-db", JSON.stringify({ walletCapAfterSave: saved, ui: await input.inputValue().catch(() => "(context reset)") }));

  await page.reload({ waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("#marketing-monthly-budget-cap");
  await page.waitForTimeout(600);
  step("budget-persist-refresh", JSON.stringify({ inputAfterRefresh: await input.inputValue() }));
  await page.screenshot({ path: path.join(SHOT_DIR, "settings-budget-set.png"), fullPage: true });

  step("budget-clear", "clear input → save → expect null");
  await input.fill("");
  await saveBtn.click();
  const cleared = await waitForCap(null);
  step("budget-clear-db", JSON.stringify({ walletCapAfterClear: cleared }));
  await page.reload({ waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("#marketing-monthly-budget-cap");
  await page.waitForTimeout(600);
  step("budget-clear-refresh", JSON.stringify({ inputAfterClearRefresh: await input.inputValue() }));
  await page.screenshot({ path: path.join(SHOT_DIR, "settings-budget-cleared.png"), fullPage: true });

  // ---- restore original language (ur) via the real toggle --------------------
  step("lang-restore", "user menu → Roman Urdu (original preference)");
  await gotoMarketing(); // English is active here; switch back to ur
  await switchLanguage("Roman Urdu");
  await gotoMarketing();
  const restored = (await safeText()).toLowerCase();
  step("language-final", JSON.stringify({
    restoredToUr: restored.includes("is hafte ke posts") && !restored.includes("posts this week"),
    persistedInDb: (await readBusinessLanguage())[0]?.language === "ur",
  }));
  await page.screenshot({ path: path.join(SHOT_DIR, "marketing-ur-restored.png"), fullPage: true });

  // ---- regression spot-checks -----------------------------------------------
  for (const [label, p] of [["home", "/"], ["products", "/dashboard/products"]]) {
    const res = await page.goto(`${BASE}${p}`, { waitUntil: "load", timeout: 60000 });
    const h1 = await page.evaluate(() => document.querySelector("h1")?.textContent?.trim() || null);
    step(`regression-${label}`, JSON.stringify({ status: res?.status(), h1 }));
  }

  // ---- cleanup ---------------------------------------------------------------
  await page.evaluate(() => localStorage.removeItem("abm-lang"));
  await setBusinessLanguage(FINAL_LANG);
  step("cleanup", JSON.stringify({
    businessLanguage: (await readBusinessLanguage())[0]?.language,
    walletCap: await walletCap(),
    localStorageOverrideCleared: true,
  }));
} catch (err) {
  report.pageErrors.push({ url: page.url(), text: `FATAL: ${err?.message}` });
  try {
    await page.screenshot({ path: path.join(SHOT_DIR, "fatal.png"), fullPage: true });
  } catch {}
} finally {
  await browser.close();
  try {
    await setBusinessLanguage(FINAL_LANG);
    await clearWalletCap();
  } catch {}
}

// ---- final report -------------------------------------------------------------
console.log("\n\n================ FINAL UI VERIFICATION REPORT ================");
console.log(`Steps: ${report.steps.length}`);
for (const s of report.steps) console.log(`\n[${s.name}] ${s.detail}`);
console.log(`\nConsole errors: ${report.consoleErrors.length}`);
for (const c of report.consoleErrors) console.log(`  @${c.url}\n    ${c.text}`);
console.log(`Page errors: ${report.pageErrors.length}`);
for (const p of report.pageErrors) console.log(`  @${p.url}\n    ${p.text}`);
console.log(`404 responses: ${report.responses404.length}`);
for (const r of report.responses404) console.log(`  404 ${r}`);
console.log("\nScreenshots:", SHOT_DIR);