/**
 * Phase 0 — docs/phase0.txt backfill verification.
 *
 * Proves the one-time backfill logic end to end against the live dev server,
 * the real account and the real AI provider chain (Roman Urdu business):
 *   1. Reports the actual count of existing active products with no
 *      social_posts row (the "before" count).
 *   2. Triggers the backfill ONCE (`POST /api/marketing/backfill`).
 *   3. Confirms every active product now has exactly one "draft" row and
 *      prints real sample rows (product name + generated caption).
 *   4. Opens the Marketing tab and confirms the drafts appear in the feed.
 *   5. Re-triggers the backfill and confirms NO duplicates were created.
 *   6. Confirms the `products` table was never modified (only social_posts
 *      rows were inserted).
 *
 * To exercise the backfill this script creates a small set of temporary
 * active products DIRECTLY (bypassing the new-product auto-draft hook), which
 * model "products that existed before the feature" — the exact backfill
 * target. It cleans them up at the end. All temporary products are restored
 * to a deleted state when done; no pre-existing product data is touched.
 *
 * Run:
 *   node tests/qa/marketing-backfill-phase0.mjs [baseURL]
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.argv[2] || "http://localhost:3001";
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
if (!session.access_token) throw new Error("sign-in failed");
const authH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` };
const business = (await fetch(
  `${SUPABASE_URL}/rest/v1/businesses?owner_id=eq.${session.user.id}&select=id,language,name&limit=1`,
  { headers: authH },
).then((r) => r.json()))[0];
const BIZ = business.id;
console.log(`[env] user=${session.user.id} business=${BIZ} name=${business.name} lang=${business.language}`);

async function rest(pathUrl, opts = {}) {
  const { headers, ...restOpts } = opts;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathUrl}`, {
    ...restOpts,
    headers: { ...authH, "Content-Type": "application/json", ...(headers || {}) },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`REST ${pathUrl} failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

const productCols = "id,name,category,price,image_url,is_active,stock_quantity,created_at";

async function listProducts() {
  return rest(
    `${encodeURIComponent("products")}?business_id=eq.${BIZ}&select=${productCols}&order=created_at.asc`,
  );
}
async function listPosts() {
  return rest(
    `${encodeURIComponent("social_posts")}?business_id=eq.${BIZ}&select=id,product_id,status,caption,platform,created_at,products:products(name)&order=created_at.asc`,
  );
}
async function activeProductsWithoutPosts() {
  const [products, posts] = await Promise.all([listProducts(), listPosts()]);
  const active = products.filter((p) => p.is_active === true);
  const postPids = new Set(posts.map((p) => p.product_id));
  return active.filter((p) => !postPids.has(p.id));
}

// ---- seed temporary "pre-existing" products (direct REST, no auto-draft) ----
const TEMP_NAMES = [
  `Phase0 Backfill Kurta ${Date.now()}`,
  `Phase0 Backfill Kameez ${Date.now()}`,
  `Phase0 Backfill Dupatta ${Date.now()}`,
];
const createdTemp = [];
for (const name of TEMP_NAMES) {
  const row = await rest(
    "products",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        business_id: BIZ,
        name,
        description: "temporary product created by phase0 backfill QA",
        category: "Kurtay",
        price: 1500,
        stock_quantity: 10,
        low_stock_threshold: 3,
        sku: null,
        image_url: null,
        is_active: true,
      }),
    },
  );
  createdTemp.push(row[0]);
}
step("seed-temp-products", JSON.stringify(
  createdTemp.map((p) => ({ id: p.id, name: p.name })),
));

// Capture exact product row snapshot for the "products untouched" check.
const productsBefore = await listProducts();
const beforeMissing = await activeProductsWithoutPosts();

// STEP 1 — before count
step("before-count", JSON.stringify({
  totalActiveProducts: productsBefore.filter((p) => p.is_active === true).length,
  activeProductsWithoutSocialPost: beforeMissing.length,
  missingNames: beforeMissing.map((p) => p.name),
  existingSocialPosts: (await listPosts()).length,
}));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") report.consoleErrors.push({ url: page.url(), text: msg.text().slice(0, 1600) });
});
page.on("pageerror", (err) =>
  report.pageErrors.push({ url: page.url(), text: String(err.message).slice(0, 600) }),
);

let backfillResponse = null;

// Authenticate the browser context directly with the real session cookie
// (same approach as tests/qa/image-test.mjs), so the app's server session
// (middleware + getServerUser) sees the owner as signed in.
const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
const authCookieName = `sb-${projectRef}-auth-token`;
const baseHost = new URL(BASE).hostname;
// Trim the session's user object to the fields Supabase SSR actually needs to
// reconstruct a valid session. The full `session.user` can exceed Chrome's
// 4096-byte per-cookie limit for this account (its identities/metadata are
// large), and middleware/getServerUser validate via the JWT access_token
// claims anyway — the stored user is only a lightweight companion record.
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

try {
  // Authenticate the browser context directly with the real session cookie
  // (same approach as tests/qa/image-test.mjs), so the app's server session
  // (middleware + getServerUser) sees the owner as signed in.
  await ctx.addCookies([
    {
      name: authCookieName,
      value: `base64-${Buffer.from(sessionJson, "utf8").toString("base64url")}`,
      domain: baseHost,
      path: "/",
    },
  ]);
  step("session-injected", `${authCookieName} set for ${BASE}`);

  // Confirm the session is honoured by landing on the protected dashboard.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 60000 });
  if (new URL(page.url()).pathname.startsWith("/login")) {
    throw new Error("browser session was not accepted; redirected to login");
  }
  step("authenticated", `loaded protected page: ${page.url()}`);

  // Run the backfill from inside the authenticated page context so the
  // server session cookies accompany the request (POST carries the session).
  step("run-backfill-1", `POST ${BASE}/api/marketing/backfill`);
  backfillResponse = await page.evaluate(async () => {
    const res = await fetch("/api/marketing/backfill", { method: "POST" });
    return { status: res.status, body: await res.json() };
  });
  step("backfill-1-result", JSON.stringify(backfillResponse));

  // STEP 3 — after count: every active product has exactly one draft.
  const postsAfter1 = await listPosts();
  const productsAfter1 = await listProducts();
  const activeAfter1 = productsAfter1.filter((p) => p.is_active === true);
  const perProduct = new Map();
  for (const post of postsAfter1) {
    if (post.product_id) {
      if (!perProduct.has(post.product_id)) perProduct.set(post.product_id, 0);
      perProduct.set(post.product_id, perProduct.get(post.product_id) + 1);
    }
  }
  const withNoDraft = activeAfter1.filter((p) => !perProduct.has(p.id));
  const withDupes = activeAfter1.filter((p) => (perProduct.get(p.id) || 0) > 1);
  const draftsForTemp = postsAfter1.filter((p) =>
    createdTemp.some((t) => t.id === p.product_id),
  );
  step("after-count-1", JSON.stringify({
    totalActiveProducts: activeAfter1.length,
    activeProductsWithDraft: activeAfter1.length - withNoDraft.length,
    activeProductsStillMissingDraft: withNoDraft.length,
    activeProductsWithMoreThanOneDraft: withDupes.length,
    totalSocialPosts: postsAfter1.length,
    sampleDraftsForTemp: draftsForTemp.map((p) => ({
      product: p.products?.name,
      product_id: p.product_id,
      status: p.status,
      platform: p.platform,
      caption: p.caption,
    })),
  }));

  // STEP 4 — Marketing tab shows the drafts in the Activity feed.
  await page.goto(`${BASE}/dashboard/marketing`, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector('h1:has-text("Marketing")', { timeout: 30000 });
  let feedText = "";
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try {
      feedText = await page.evaluate(() => document.querySelector("main")?.textContent || "");
      if (TEMP_NAMES.some((n) => feedText.includes(n))) break;
    } catch {}
    await page.waitForTimeout(500);
  }
  const feedChecks = {
    tempProduct1Shown: feedText.includes(TEMP_NAMES[0]),
    tempProduct2Shown: feedText.includes(TEMP_NAMES[1]),
    tempProduct3Shown: feedText.includes(TEMP_NAMES[2]),
    anyDraftCaptionShown: draftsForTemp.some(
      (d) => d.caption && feedText.includes(d.caption.slice(0, 40)),
    ),
    draftStatusPresent: /\bdraft\b/i.test(feedText),
  };
  step("marketing-feed", JSON.stringify(feedChecks));

  // STEP 5 — run the backfill a second time, confirm NO duplicates.
  step("run-backfill-2", "re-running backfill");
  await page.evaluate(() => fetch("/api/marketing/backfill", { method: "POST" }).then((r) => r.json()));
  await page.waitForTimeout(1200);
  const postsAfter2 = await listPosts();
  const perProduct2 = new Map();
  for (const post of postsAfter2) {
    if (post.product_id) perProduct2.set(post.product_id, (perProduct2.get(post.product_id) || 0) + 1);
  }
  const activeAfter2 = (await listProducts()).filter((p) => p.is_active === true);
  const withDupes2 = activeAfter2.filter((p) => (perProduct2.get(p.id) || 0) > 1);
  const stillMissing2 = activeAfter2.filter((p) => !perProduct2.has(p.id));
  step("after-count-2", JSON.stringify({
    totalActiveProducts: activeAfter2.length,
    activeProductsStillMissingDraft: stillMissing2.length,
    activeProductsWithMoreThanOneDraft: withDupes2.length,
    totalSocialPosts: postsAfter2.length,
    unchanged: postsAfter2.length === postsAfter1.length,
  }));

  // STEP 6 — confirm products table was NOT modified by the backfill.
  const productsAfterBackfill = await listProducts();
  const productsChanged = productsBefore.length !== productsAfterBackfill.length ||
    productsBefore.some((b) => {
      const a = productsAfterBackfill.find((x) => x.id === b.id);
      return !a || a.name !== b.name || a.price !== b.price ||
        a.is_active !== b.is_active || a.stock_quantity !== b.stock_quantity;
    });
  step("products-untouched", JSON.stringify({
    productCountBefore: productsBefore.length,
    productCountAfter: productsAfterBackfill.length,
    anyProductDataChanged: productsChanged,
  }));
} catch (err) {
  report.pageErrors.push({ url: page.url(), text: `FATAL: ${err?.message}` });
} finally {
  // Clean up temporary products (hard delete via REST; they have no orders)
  // and their social_posts drafts, restoring the business to its prior state.
  const cleanup = [];
  for (const temp of createdTemp) {
    try {
      await rest(
        `${encodeURIComponent("social_posts")}?business_id=eq.${BIZ}&product_id=eq.${temp.id}`,
        { method: "DELETE" },
      );
    } catch {}
    try {
      await rest(`${encodeURIComponent("products")}?id=eq.${temp.id}`, { method: "DELETE" });
      cleanup.push(`deleted ${temp.name}`);
    } catch (e) {
      cleanup.push(`delete-failed ${temp.name}: ${e?.message}`);
    }
  }
  step("cleanup", JSON.stringify(cleanup));
  await browser.close();
}

console.log("\n\n=============== PHASE 0 BACKFILL VERIFICATION ===============");
console.log(`Steps: ${report.steps.length}`);
for (const s of report.steps) console.log(`\n[${s.name}] ${s.detail}`);
console.log(`\nConsole errors: ${report.consoleErrors.length}`);
for (const c of report.consoleErrors) console.log(`  @${c.url}\n    ${c.text}`);
console.log(`Page errors: ${report.pageErrors.length}`);
for (const p of report.pageErrors) console.log(`  @${p.url}\n    ${p.text}`);
