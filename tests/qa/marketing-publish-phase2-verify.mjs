/**
 * Phase 2 (reduced) — docs/phase2update.txt live verification:
 *  - Adding a product creates a REAL AI-generated caption saved as a
 *    social_posts "draft" (no Meta credentials needed).
 *  - The Marketing Activity feed shows the real draft (product name, caption
 *    preview, "Draft — not yet connected" status) and a Publish button.
 *  - Clicking Publish shows the honest "not connected" message — never a fake
 *    publish.
 *  - Everything above works in Roman Urdu (the test language).
 *
 * Real Chrome + the real dev server + the real account + real AI provider.
 * Run:
 *   node tests/qa/marketing-publish-phase2-verify.mjs [baseURL]
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.argv[2] || "http://localhost:3001";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SHOT_DIR = path.resolve("tests/qa/shots");
const LANG = "ur";

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

const report = { steps: [], consoleErrors: [], pageErrors: [] };
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
console.log(`[env] user=${session.user.id} business=${BIZ} initialLang=${business.language} testLang=${LANG}`);

async function setBusinessLanguage(lang) {
  await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${BIZ}`, {
    method: "PATCH",
    headers: { ...authH, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ language: lang }),
  });
}
async function listSocialPosts() {
  return fetch(
    `${SUPABASE_URL}/rest/v1/social_posts?business_id=eq.${BIZ}&select=id,product_id,caption,status,platform,created_at,products:products(name)&order=created_at.desc&limit=20`,
    { headers: authH },
  ).then((r) => r.json());
}
async function getProducts() {
  return fetch(
    `${SUPABASE_URL}/rest/v1/products?business_id=eq.${BIZ}&select=id,name,category,price,is_active&order=created_at.desc`,
    { headers: authH },
  ).then((r) => r.json());
}
async function waitForDraftForProduct(productId, ms = 60000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    const rows = await listSocialPosts();
    last = rows.find((r) => r.product_id === productId);
    if (last) return { ok: true, draft: last };
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { ok: false, last };
}

// Deterministic Roman Urdu baseline.
await setBusinessLanguage(LANG);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on("console", (msg) => {
  if (msg.type() === "error") report.consoleErrors.push({ url: page.url(), text: msg.text().slice(0, 1600) });
});
page.on("pageerror", (err) =>
  report.pageErrors.push({ url: page.url(), text: String(err.message).slice(0, 600) }),
);

const mainText = () => page.evaluate(() => document.querySelector("main")?.textContent || "");

const TEST_PRODUCT = `Phase2 Test Kurta ${Date.now()}`;

try {
  // ---- login ---------------------------------------------------------------
  step("login", `GET ${BASE}/login`);
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120000 });
  await page.locator("#login-email").fill(EMAIL);
  await page.locator("#login-password").fill(PASSWORD);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
  await page.evaluate((l) => localStorage.setItem("abm-lang", l), LANG);
  step("login-ok", `landed at ${page.url()}; localStorage abm-lang=${LANG}`);

  // ---- add a real product via the Products page UI -------------------------
  step("add-product", `navigating to products to add "${TEST_PRODUCT}"`);
  await page.goto(`${BASE}/dashboard/products`, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector('h1:has-text("Products")', { timeout: 30000 });
  await page.getByRole("button", { name: /add product|product add karein|Product add karein/i }).first().click().catch(async () => {
    // Fall back to locating the primary action button.
    await page.locator("[data-testid='add-product']").first().click().catch(() => {
      throw new Error("could not find add-product button");
    });
  });
  await page.waitForSelector("#product-name", { timeout: 30000 });
  await page.locator("#product-name").fill(TEST_PRODUCT);
  await page.locator("#product-category").fill("Kurtay");
  await page.locator("#product-price").fill("2500");
  await page.locator("#product-stock").fill("10");
  await page.getByRole("button", { name: /save|save karein/i }).first().click();
  step("add-product-submitted", "waiting for product to appear in list");
  await page.waitForSelector(`text="${TEST_PRODUCT}"`, { timeout: 60000 });
  step("add-product-visible", `product "${TEST_PRODUCT}" visible in list`);

  // ---- verify draft post created with a REAL AI caption --------------------
  const products = await getProducts();
  const created = products.find((p) => p.name === TEST_PRODUCT);
  if (!created) throw new Error("created product not found via API");
  step("product-created", JSON.stringify({ id: created.id, name: created.name, price: created.price }));

  const draftWait = await waitForDraftForProduct(created.id);
  if (!draftWait.ok) throw new Error(`draft post not created for product within timeout; last=${JSON.stringify(draftWait.last)}`);
  const draft = draftWait.draft;
  step("draft-created", JSON.stringify({
    postId: draft.id,
    status: draft.status,
    platform: draft.platform,
    caption: draft.caption,
  }));

  // ---- verify the Activity feed shows the draft (Roman Urdu) ---------------
  await page.goto(`${BASE}/dashboard/marketing`, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector('h1:has-text("Marketing")', { timeout: 30000 });
  // Wait for the draft's caption text + product name to render.
  let feedText = "";
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try {
      feedText = await mainText();
      if (feedText.includes(TEST_PRODUCT)) break;
    } catch {}
    await page.waitForTimeout(500);
  }
  const draftStatusUr = "Draft — Instagram/Facebook se abhi connect nahi hai";
  const feedChecks = {
    productNameShown: feedText.includes(TEST_PRODUCT),
    captionPreviewShown: Boolean(draft.caption && feedText.includes(draft.caption.slice(0, 60))),
    draftStatusUr: feedText.includes(draftStatusUr),
    publishButton: (await page.getByRole("button", { name: /publish karein/i }).count()) > 0,
  };
  step("activity-feed", JSON.stringify(feedChecks));
  await page.screenshot({ path: path.join(SHOT_DIR, "phase2-activity-ur.png"), fullPage: true });

  // ---- click Publish -> honest "not connected" message, no fake publish ----
  await page.getByRole("button", { name: /publish karein/i }).first().click();
  await page.waitForTimeout(1500);
  const afterPublish = await mainText();
  const publishChecks = {
    notConnectedUr: afterPublish.includes(
      "Instagram/Facebook account abhi connect nahi hua. Pehle Settings mein connect karein.",
    ),
    stillDraft: !afterPublish.includes("Published"),
  };
  step("publish-click", JSON.stringify(publishChecks));
  await page.screenshot({ path: path.join(SHOT_DIR, "phase2-publish-notconnected-ur.png"), fullPage: true });

  // Confirm the row is STILL a draft (never faked to published).
  const still = await listSocialPosts();
  const stillDraft = still.find((r) => r.id === draft.id);
  step("row-not-faked", JSON.stringify({ statusAfterClick: stillDraft?.status }));
} catch (err) {
  report.pageErrors.push({ url: page.url(), text: `FATAL: ${err?.message}` });
  try {
    await page.screenshot({ path: path.join(SHOT_DIR, "phase2-fatal.png"), fullPage: true });
  } catch {}
} finally {
  await browser.close();
  await setBusinessLanguage(LANG).catch(() => {});
}

console.log("\n\n================ PHASE 2 (REDUCED) VERIFICATION REPORT ================");
console.log(`Steps: ${report.steps.length}`);
for (const s of report.steps) console.log(`\n[${s.name}] ${s.detail}`);
console.log(`\nConsole errors: ${report.consoleErrors.length}`);
for (const c of report.consoleErrors) console.log(`  @${c.url}\n    ${c.text}`);
console.log(`Page errors: ${report.pageErrors.length}`);
for (const p of report.pageErrors) console.log(`  @${p.url}\n    ${p.text}`);
console.log("\nScreenshots:", SHOT_DIR);
