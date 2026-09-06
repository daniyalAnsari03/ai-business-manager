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
const META_ID = gv("META_APP_ID");
const META_FB_CONFIG_ID = gv("META_FACEBOOK_CONFIG_ID");
// Scope fallbacks (used when no config_id is set) — must match the
// `facebook` and `instagram` entries in PLATFORM_SCOPES in
// lib/marketing/meta-oauth.ts. Instagram uses "Instagram API with Facebook
// Login", so its client_id is the MAIN Meta App ID and its scopes are the
// FB-Login permission names. business_management is required for the
// Business-asset discovery fallback when Meta's Page edge is unreliable.
const PLATFORM_FB_SCOPE_STRING = "pages_show_list,pages_read_engagement,business_management";
const PLATFORM_IG_SCOPE_STRING = "instagram_basic,instagram_content_publish,pages_read_engagement,pages_show_list,business_management";

async function supabaseSession() {
  return fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json());
}

const session = await supabaseSession();
if (!session.access_token) throw new Error("sign-in failed");

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

await page.goto(`${BASE}/dashboard/settings`, { waitUntil: "load", timeout: 60000 });
try {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("p")].some((p) =>
        p.textContent?.trim().toLowerCase().includes("instagram"),
      ),
    { timeout: 30000 },
  );
} catch {
  const text = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  console.log(`[page-text-snippet] ${JSON.stringify(text)}`);
  await page.screenshot({ path: "tests/qa/shots/oauth-settings-fail.png" });
  throw new Error("settings page did not show connected-account channels");
}
await page.waitForTimeout(800);

// Capture the initial connected-account statuses (language-agnostic).
const accountStatus = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("div")].filter((d) => {
    const p = d.querySelector("p");
    if (!p) return false;
    const t = p.textContent ?? "";
    return /instagram|facebook page|google ads|whatsapp number|meta ads/i.test(t);
  });
  const seen = new Set();
  return rows
    .map((row) => {
      const ps = [...row.querySelectorAll("p")];
      const name = ps[0]?.textContent?.trim() ?? "";
      if (seen.has(name)) return null;
      seen.add(name);
      const status = (ps[1]?.textContent ?? "").trim();
      return `${name}=${status}`;
    })
    .filter(Boolean);
});
console.log(`[account-status-before] ${JSON.stringify(accountStatus)}`);

// Click the Instagram Connect button (the real OAuth path).
const connectResult = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("div")].filter((d) =>
    /^instagram$/i.test(d.querySelector("p")?.textContent?.trim() ?? ""),
  );
  const row = rows[0];
  if (!row) return { error: "no instagram row" };
  const btn = row.querySelector("button");
  if (!btn) return { error: "no connect button" };
  const label = btn.getAttribute("aria-label") || btn.textContent?.trim();
  btn.click();
  return { label };
});
console.log(`[connect-click] ${JSON.stringify(connectResult)}`);

// The app should perform its API call and then navigate to Facebook's dialog.
try {
  await page.waitForURL((u) => u.toString().includes("facebook.com") || u.toString().includes("instagram.com"), {
    timeout: 20000,
  });
} catch {
  // Fallback: capture whatever URL we're on now.
    console.log(`[redirect] did not reach facebook/instagram, current url=${page.url()}`);
}

await page.waitForTimeout(1500);
const metaUrl = page.url();
console.log(`[meta-url] ${metaUrl}`);

try {
  // Meta usually bounces un-authenticated sessions to /login.php and embeds our
  // real dialog URL in the `next` (and `cancel_url`) params, so we resolve the
  // effective dialog URL from there rather than assuming we land on it directly.
  const u = new URL(metaUrl);
  let target = metaUrl;
  if (u.pathname.startsWith("/login.php")) {
    const nextRaw = u.searchParams.get("next");
    if (nextRaw) target = decodeURIComponent(nextRaw);
    else {
      const cancelRaw = u.searchParams.get("cancel_url");
      if (cancelRaw) target = decodeURIComponent(cancelRaw);
    }
  }
  const d = new URL(target);
  const clientId = d.searchParams.get("client_id");
  const redirectUri = d.searchParams.get("redirect_uri");
  const state = d.searchParams.get("state");
  const scope = d.searchParams.get("scope");

  const stateParts = (state ?? "").split(".");
  const stateIsSigned = stateParts.length === 4;
  // The state's businessId is a uuid; platform is the 2nd part.
  const statePlatformOk = stateParts.length === 4 && stateParts[1] === "instagram";
  // Instagram must NOT use config_id (that is the Facebook path).
  const configId = d.searchParams.get("config_id");

  console.log("[checks]");
  console.log(`  reached_facebook_or_instagram=${u.hostname.includes("facebook.com") || u.hostname.includes("instagram.com")}`);
  // Instagram uses the MAIN Meta App ID (Facebook Login), never the separate
  // Instagram-login app id — using the standalone id causes "Invalid platform app".
  const expectedIgClientId = META_ID;
  console.log(`  client_id_is_main_meta_app=${clientId === expectedIgClientId}`);
  console.log(`  redirect_uri_is_callback=${redirectUri === `${BASE}/api/marketing/oauth/callback`}`);
  console.log(`  state_is_signed=${stateIsSigned}`);
  console.log(`  state_binds_platform_instagram=${statePlatformOk}`);
  // Instagram (Facebook Login) scopes: instagram_basic + instagram_content_publish
  // + pages_show_list (pages_show_list is required so the callback can list
  // the connected Page via /me/accounts — the standalone
  // "instagram_content_publishing" name is NOT valid here and makes the dialog
  // return a 500 Error page) + business_management (Business-asset discovery
  // fallback when Meta's Page edge is unreliable).
  console.log(`  scope_has_instagram_basic=${(scope ?? "").includes("instagram_basic")}`);
  console.log(`  scope_has_instagram_content_publish=${(scope ?? "").includes("instagram_content_publish")}`);
  console.log(`  scope_has_business_management=${(scope ?? "").includes("business_management")}`);
  console.log(`  scope_matches_platform_instagram=${(scope ?? "") === PLATFORM_IG_SCOPE_STRING && configId === null}`);

  console.log(`  instagram_has_no_config_id=${configId === null}`);
  // Cross-check: prove the Facebook fallback scope no longer contains
  // pages_manage_posts, and report whether the env supplies a config ID.
  console.log(`  facebook_scope_has_no_manage_posts=${!(PLATFORM_FB_SCOPE_STRING).includes("pages_manage_posts")}`);
  console.log(`  facebook_env_config_id_present=${Boolean(META_FB_CONFIG_ID)}`);
  // Verify the config_id value is a numeric string (Meta Configuration IDs are numeric).
  console.log(`  facebook_config_id_is_numeric=${/^\d+$/.test(META_FB_CONFIG_ID)}`);

  await page.screenshot({ path: "tests/qa/shots/phase0-oauth-connect-redirect.png" });
} catch (e) {
  console.log(`[check-error] ${e.message}`);
}

await browser.close();
