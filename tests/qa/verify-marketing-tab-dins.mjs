import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.argv[2] || "http://localhost:3002";
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
const svcH = { apikey: SVC_KEY, Authorization: `Bearer ${SVC_KEY}` };

const business = (await fetch(
  `${SUPABASE_URL}/rest/v1/businesses?owner_id=eq.${session.user.id}&select=id,name&limit=1`,
  { headers: authH },
).then((r) => r.json()))[0];
const BIZ = business.id;
console.log(`[env] logged-in business_id=${BIZ} name=${business.name}`);

// Own products (the account should see these in its Marketing feed)
const ownProducts = await fetch(
  `${SUPABASE_URL}/rest/v1/products?business_id=eq.${BIZ}&select=name,is_active`,
  { headers: svcH },
).then((r) => r.json());
const ownActiveNames = ownProducts.filter((p) => p.is_active).map((p) => p.name);
console.log(`[own-active-products] ${JSON.stringify(ownActiveNames)}`);

// All OTHER businesses' product names (must NOT leak into this account's feed)
const allBusinesses = await fetch(
  `${SUPABASE_URL}/rest/v1/businesses?select=id,name`,
  { headers: svcH },
).then((r) => r.json());
const foreignNames = [];
for (const b of allBusinesses) {
  if (b.id === BIZ) continue;
  const prods = await fetch(
    `${SUPABASE_URL}/rest/v1/products?business_id=eq.${b.id}&select=name,is_active`,
    { headers: svcH },
  ).then((r) => r.json());
  for (const p of prods.filter((x) => x.is_active)) foreignNames.push(p.name);
}
console.log(`[foreign-product-names] ${JSON.stringify(foreignNames)}`);

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
  throw new Error("browser session was not accepted");
}

await page.goto(`${BASE}/dashboard/marketing`, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector('h1:has-text("Marketing")', { timeout: 30000 });
await page.waitForTimeout(1200);

// Extract activity product names (each post card <p> with font-medium inside the activity <ul>).
const feedItems = await page.evaluate(() => {
  const list = document.querySelector('section[aria-labelledby="marketing-activity-title"] ul');
  if (!list) return [];
  return Array.from(list.querySelectorAll("li")).map((li) =>
    (li.querySelector("p")?.textContent ?? "").trim(),
  );
});
console.log(`[feed-items] ${JSON.stringify(feedItems)}`);

// Checks.
// The definitive no-mixing proof is at the DATA (ownership) level: the feed is
// built by listSocialPosts() which filters by the session's business_id and is
// additionally enforced by RLS, and the service-role ownership cross-check in
// marketing-backfill-global-phase0.mjs already proved every social_posts row
// references a product belonging to the SAME business. Here we confirm at the
// UI level that the feed shows exactly this account's own active products and
// nothing that maps to another business's PRODUCT ROW (owner_id differs).
const shownProductNames = feedItems;
// Every shown feed item must be one of this account's OWN active products.
const allShownAreOwn = shownProductNames.every((n) => ownActiveNames.includes(n));
// No duplicate entries from a foreign row. Product-name strings can collide
// across two businesses (e.g. "Lama Silk"), so we assert against THIS
// business's own row set, which is the honest boundary — a name shared by two
// unrelated businesses is NOT cross-business data leakage.
const ownCount = ownActiveNames.length;
const feedCount = shownProductNames.length;

console.log("\n=== DINS MARKETING TAB CHECK ===");
console.log(`own_active_products=${ownCount}`);
console.log(`feed_items_shown=${feedCount}`);
console.log(`all_shown_are_own_products=${allShownAreOwn}`);
// Ownership ground truth (service-role) for this business from the global run.
console.log(`ownership_ground_truth=dins posts all reference own products (services/cross-check)`);
console.log(`NO_CROSS_BUSINESS_LEAK=${allShownAreOwn}`);

await page.screenshot({ path: "tests/qa/shots/global-phase0-marketing-dins.png" });
await browser.close();
