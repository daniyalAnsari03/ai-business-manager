/**
 * Phase 0 — docs/phase0.txt GLOBAL backfill verification (scope change).
 *
 * Calls the ADMIN-only global backfill endpoint
 * (POST /api/marketing/backfill-all) from an authenticated session, which
 * enumerates EVERY business via the service-role client and backfills each
 * from its own products with its own language. It then:
 *   1. Prints the raw per-business result (real business_ids + real counts).
 *   2. Re-calls the endpoint and confirms zero new rows were created
 *      (global idempotency, not just per-business).
 *   3. Verifies each business's drafts only reference its OWN products.
 *
 * Run:
 *   node tests/qa/marketing-backfill-global-phase0.mjs [baseURL]
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
console.log(`[env] user=${session.user.id} business=${business.id} name=${business.name} lang=${business.language}`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

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

await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 60000 });
if (new URL(page.url()).pathname.startsWith("/login")) {
  throw new Error("browser session was not accepted; redirected to login");
}

async function callGlobalBackfill() {
  return page.evaluate(async () => {
    const res = await fetch("/api/marketing/backfill-all", { method: "POST" });
    return { status: res.status, body: await res.json() };
  });
}

console.log("\n=== RUN 1 — GLOBAL BACKFILL (ALL BUSINESSES) ===");
const run1 = await callGlobalBackfill();
console.log("HTTP", run1.status);
console.log(JSON.stringify(run1.body, null, 2));

if (run1.status !== 200 || run1.body?.ok !== true) {
  console.error("\nGLOBAL BACKFILL FAILED — aborting (no data will be fabricated).");
  await browser.close();
  process.exit(1);
}

const businesses = run1.body.data.businesses;

console.log("\n=== RUN 2 — RE-RUN FOR GLOBAL IDEMPOTENCY ===");
const run2 = await callGlobalBackfill();
console.log("HTTP", run2.status);
if (run2.status !== 200 || run2.body?.ok !== true) {
  console.error("Run 2 failed:", JSON.stringify(run2.body));
  await browser.close();
  process.exit(1);
}
const zeroNew = businesses.every(
  (b) => (run2.body.data.businesses.find((x) => x.business_id === b.business_id)?.drafts_created ?? -1) === 0,
);
console.log("any_new_drafts_on_rerun:", !zeroNew);
console.log("GLOBAL_IDEMPOTENT:", zeroNew);

// Verify no business's drafts reference another business's products: the
// global report never mixes data because each business is backfilled only
// from its own product set. Cross-check every business's social_posts only
// reference its own products using the service-role REST path.
console.log("\n=== OWNERSHIP BOUNDARY CROSS-CHECK (service-role) ===");
{
  const svcKey = (() => {
    const l = envRaw.split(/\r?\n/).find((x) => x.startsWith("SUPABASE_SERVICE_ROLE_KEY="));
    return l ? l.slice("SUPABASE_SERVICE_ROLE_KEY=".length).trim() : "";
  })();
  const svcH = { apikey: svcKey, Authorization: `Bearer ${svcKey}` };
  let allOk = true;
  for (const b of businesses) {
    const [prods, posts] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/products?business_id=eq.${b.business_id}&select=id`, { headers: svcH }).then((r) => r.json()),
      fetch(`${SUPABASE_URL}/rest/v1/social_posts?business_id=eq.${b.business_id}&select=product_id`, { headers: svcH }).then((r) => r.json()),
    ]);
    const prodIds = new Set(prods.map((p) => p.id));
    const leaked = posts.filter((p) => p.product_id && !prodIds.has(p.product_id));
    if (leaked.length > 0) {
      allOk = false;
      console.log(`  !! ${b.business_name} has ${leaked.length} drafts referencing foreign products`);
    } else {
      console.log(`  ok  ${b.business_name} (${b.business_id}) posts=${posts.length} all own-products`);
    }
  }
  console.log("OWNERSHIP_BOUNDARIES_OK:", allOk);
  if (!allOk) process.exitCode = 1;
}

await browser.close();
console.log("\nDONE");
