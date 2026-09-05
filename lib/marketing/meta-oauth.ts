/**
 * Meta OAuth for connecting a business's Instagram professional account or
 * Facebook Page.
 *
 * Flow (server-side only; secrets never leave the server):
 *   1. buildAuthorizeUrl() -> the owner is redirected to Facebook's
 *      dialog/oauth with a signed `state` that binds the intended platform
 *      to THIS business. The signature prevents CSRF / state forgery.
 *   2. Facebook redirects to the callback route with `code` + `state`.
 *   3. verifyState() re-derives and checks the signature, expiry and that
 *      the state matches the authenticated business + platform.
 *   4. exchangeCodeForToken() swaps the short-lived code for an access token.
 *   5. discoverPage() reads the owner's Pages (me/accounts), requesting each
 *      Page's `instagram_business_account` up front, and selects the FIRST
 *      Page that actually has a linked Instagram Business account (a plain
 *      Facebook connect accepts any Page). The right account_label and
 *      external ids can then be persisted.
 *   6. discoverInstagram() remains available to verify the Instagram Business
 *      account of ONE specific Page when callers do not use the discovery
 *      selection above.
 *
 * Instagram uses the SAME flow as Facebook ("Instagram API with Facebook
 * Login"): authorize with the main Meta App ID on facebook.com/dialog/oauth,
 * exchange on graph.facebook.com, then read the connected Instagram business
 * account through the owner's Page. The standalone Instagram-login product
 * (www.instagram.com/oauth/authorize + graph.instagram.com + its own App ID)
 * is intentionally NOT used.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getMetaAppConfig, type MetaAppConfig } from "@/lib/marketing/meta-config";

export const SUPPORTED_OAUTH_PLATFORMS = ["instagram", "facebook"] as const;
export type OAuthPlatform = (typeof SUPPORTED_OAUTH_PLATFORMS)[number];

export function isOAuthPlatform(value: string): value is OAuthPlatform {
  return (SUPPORTED_OAUTH_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Scopes required to read (and publish to) each channel.
 *
 * 2026 note: Both channels use the MAIN Meta App ID through the Facebook
 * Login dialog (facebook.com/dialog/oauth). This mirrors the app's actual
 * Meta dashboard configuration ("Instagram API with Facebook Login").
 *
 * - Instagram ("Instagram API with Facebook Login"):
 *     instagram_basic, instagram_content_publish, pages_read_engagement,
 *     pages_show_list
 *   The first three are the exact permission names Meta's Content Publishing
 *   guide requires for this product (the standalone "Instagram API with
 *   Instagram Login" names — instagram_business_basic /
 *   instagram_content_publishing — are a DIFFERENT app class and are NOT
 *   valid here; using them makes the Facebook dialog return a 500 "Error"
 *   page).
 *   `pages_show_list` is REQUIRED for the discovery step: the callback reads
 *   the connected Page through GET /me/accounts, and Meta returns an empty
 *   list for that edge unless the user has granted `pages_show_list`. Without
 *   it the IG connect flow always fails with "No Facebook Page found" at the
 *   exact discovery step even when the user fully consents.
 *   Token exchange and all IG publishing API calls run on graph.facebook.com.
 *
 * - Facebook ("Facebook Login for Business"):
 *     pages_show_list, pages_read_engagement, business_management
 *   When a Facebook Login for Business Configuration ID is provided
 *   (META_FACEBOOK_CONFIG_ID), the `config_id` parameter replaces `scope`
 *   entirely — the configuration defines which permissions are requested.
 *   `pages_manage_posts` is NOT used; the Configuration ID controls access.
 */
const PLATFORM_SCOPES: Record<OAuthPlatform, string> = {
  facebook: "pages_show_list,pages_read_engagement,business_management",
  instagram:
    "instagram_basic,instagram_content_publish,pages_read_engagement,pages_show_list",
};

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough for Meta login.

interface OAuthState {
  businessId: string;
  platform: OAuthPlatform;
  iat: number;
}

function signState(appSecret: string, payload: string): string {
  return createHmac("sha256", appSecret).update(payload).digest("hex");
}

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Builds the signed `state` value carried through Facebook's OAuth round trip.
 * Binding businessId + platform to a signature prevents a callback from being
 * replayed against a different account or channel.
 */
export function createState(
  cfg: MetaAppConfig,
  businessId: string,
  platform: OAuthPlatform,
): string {
  const payload = [businessId, platform, Date.now()].join(".");
  const sig = signState(cfg.appSecret, payload);
  return `${payload}.${sig}`;
}

export type StateVerificationResult =
  | { ok: true; state: OAuthState }
  | { ok: false; reason: "malformed" | "not_configured" | "expired" | "signature_mismatch" };

/**
 * Verifies a `state` value returned by Facebook. Rejects anything that was
 * not signed by this app, anything older than STATE_TTL, and reports the
 * platform + business it was originally minted for so the callback can make
 * sure they still match the authenticated session.
 */
export function verifyState(raw: string): StateVerificationResult {
  const cfg = getMetaAppConfig();
  if (!cfg) return { ok: false, reason: "not_configured" };

  const parts = raw.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };

  const [businessId, platform, iatRaw, sig] = parts;
  const payload = [businessId, platform, iatRaw].join(".");
  const expected = signState(cfg.appSecret, payload);
  if (!safeEquals(sig, expected)) return { ok: false, reason: "signature_mismatch" };

  const iat = Number(iatRaw);
  if (!Number.isFinite(iat)) return { ok: false, reason: "malformed" };
  if (Date.now() - iat > STATE_TTL_MS || Date.now() < iat) {
    return { ok: false, reason: "expired" };
  }
  if (!isOAuthPlatform(platform)) return { ok: false, reason: "malformed" };

  return { ok: true, state: { businessId, platform, iat } };
}

/**
 * Resolves the OAuth callback URL.
 *
 * Meta validates the domain of the redirect_uri against the app's configured
 * "App Domains" and the exact URI against "Valid OAuth Redirect URIs". The
 * host that carries an OAuth request can vary (localhost, a LAN IP, the
 * deployment domain), so we allow a canonical base to be pinned with
 * META_OAUTH_REDIRECT_URL. When it is set that value is used verbatim and MUST
 * exactly match the URI registered in the Meta App Dashboard; otherwise we
 * fall back to deriving it from the current request's origin.
 */
export function resolveOAuthRedirectUri(requestOrUrl: string | URL): string {
  const canonical = process.env.META_OAUTH_REDIRECT_URL?.trim();
  if (canonical) {
    return canonical.endsWith("/api/marketing/oauth/callback")
      ? canonical
      : `${canonical.replace(/\/$/, "")}/api/marketing/oauth/callback`;
  }
  return new URL("/api/marketing/oauth/callback", requestOrUrl).toString();
}

/**
 * The canonical public base (scheme + host) that the app is reachable at from
 * Meta's redirect. This mirrors `resolveOAuthRedirectUri` so that every hop of
 * the OAuth round trip — the authorize step, the token exchange and the
 * post-callback redirect back into the app — stays on ONE public HTTPS origin.
 *
 * In dev it is common for the request to arrive through a public tunnel (e.g.
 * ngrok) while `request.url` still resolves to `localhost:<port>`. Redirecting
 * back to that private origin would (a) drop the browser onto a host that has
 * no HTTPS cert (`ERR_SSL_PROTOCOL_ERROR`) and (b) leave the user on a
 * different origin than the one holding their session cookie, making the
 * callback appear `unauthorized`. Pinning the redirect to the configured
 * public origin avoids both.
 */
export function resolveOAuthBaseUrl(requestOrUrl: string | URL): string {
  const canonical = process.env.META_OAUTH_REDIRECT_URL?.trim();
  if (canonical) {
    try {
      return new URL("/", canonical).origin;
    } catch {
      // Fall through to the request-derived origin on a malformed value.
    }
  }
  try {
    return new URL("/", requestOrUrl).origin;
  } catch {
    return "/";
  }
}

export interface AuthorizeUrlOptions {
  platform: OAuthPlatform;
  businessId: string;
  redirectUri: string;
}

/**
 * The Facebook dialog/oauth URL the owner is redirected to. The redirect_uri
 * is our callback route; the state binds this connection attempt to the
 * current authenticated business so the callback can safely finish it.
 *
 * BOTH Instagram and Facebook authorize through facebook.com/dialog/oauth
 * with the MAIN Meta App ID (META_APP_ID). This app's Meta dashboard is set
 * up for "Instagram API with Facebook Login", so the Instagram scopes live on
 * the same dialog as the Facebook scopes. For Facebook with a Login for
 * Business Configuration ID (META_FACEBOOK_CONFIG_ID), the `config_id`
 * parameter replaces `scope`.
 */
export function buildAuthorizeUrl(options: AuthorizeUrlOptions): string {
  const cfg = getMetaAppConfig();
  if (!cfg) {
    throw new Error("Meta is not configured; cannot build authorize URL.");
  }

  const url = new URL(cfg.dialogOauthBase);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("state", createState(cfg, options.businessId, options.platform));
  url.searchParams.set("response_type", "code");

  // Facebook Login for Business: when a Configuration ID is available, use
  // `config_id` instead of `scope`. The configuration defines the exact set
  // of permissions and assets the user will see in the consent dialog.
  //
  // When the configuration targets System User / Business Integration System
  // User (BISU) tokens, Facebook requires BOTH `response_type=code` AND
  // `override_default_response_type=true`, otherwise the config's default
  // (non-code) response type wins and no auth `code` is ever returned to the
  // callback. `override_default_response_type=true` is documented by Meta for
  // this exact case and is harmless for user-access-token configurations.
  if (options.platform === "facebook" && cfg.facebookConfigId) {
    url.searchParams.set("config_id", cfg.facebookConfigId);
    url.searchParams.set(
      "override_default_response_type",
      "true",
    );
  } else {
    url.searchParams.set("scope", PLATFORM_SCOPES[options.platform]);
  }

  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
}

/** Exchanges the short-lived `code` for an access token via the Graph API. */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<
  { ok: true; accessToken: string; expiresIn?: number } | { ok: false; message: string }
> {
  const cfg = getMetaAppConfig();
  if (!cfg) return { ok: false, message: "Meta not configured." };

  return exchangeWithOptions(cfg, code, redirectUri);
}

/**
 * Performs the Graph API `/oauth/access_token` exchange. For standard
 * Facebook Login, `redirect_uri` is REQUIRED and must match the authorize
 * request. For Facebook Login for Business / BISU (config_id) flows, Meta's
 * documented exchange omits `redirect_uri`, so we try with it first, then
 * retry without it when Meta rejects the first attempt.
 */
async function exchangeWithOptions(
  cfg: MetaAppConfig,
  code: string,
  redirectUri: string,
): Promise<
  { ok: true; accessToken: string; expiresIn?: number } | { ok: false; message: string }
> {
  const attempts: Array<{ label: string; redirectUri: string }> = [
    { label: "with_redirect_uri", redirectUri },
    { label: "without_redirect_uri", redirectUri: "" },
  ];

  for (const attempt of attempts) {
    const url = new URL(`${cfg.graphApiBase}/oauth/access_token`);
    url.searchParams.set("client_id", cfg.appId);
    url.searchParams.set("client_secret", cfg.appSecret);
    url.searchParams.set("code", code);
    if (attempt.redirectUri) {
      url.searchParams.set("redirect_uri", attempt.redirectUri);
    }

    console.log(`[FB-OAuth-Token] attempt=${attempt.label}`);
    let res: Response;
    try {
      res = await fetch(url.toString(), { method: "GET" });
    } catch (e) {
      console.log("[FB-OAuth-Token] FETCH ERROR:", e);
      return { ok: false, message: "Could not reach Meta." };
    }

    let json: TokenResponse;
    try {
      json = (await res.json()) as TokenResponse;
    } catch (e) {
      console.log(`[FB-OAuth-Token] JSON PARSE ERROR (${attempt.label}):`, e);
      return { ok: false, message: "Unexpected response from Meta." };
    }

    console.log(`[FB-OAuth-Token] HTTP status=${res.status} has_access_token=${!!json.access_token} expires_in=${json.expires_in}`);
    if (json.error) console.log(`[FB-OAuth-Token] error=${JSON.stringify(json.error)}`);

    if (res.ok && json.access_token) {
      return { ok: true, accessToken: json.access_token, expiresIn: json.expires_in };
    }

    const message = json.error?.message ?? "Meta rejected the code.";
    // A redirect_uri-related error means this attempt's shape is wrong for
    // this config; try the other form before giving up.
    const isRedirectUriIssue =
      message.toLowerCase().includes("redirect_uri") ||
      message.toLowerCase().includes("redirect uri") ||
      (json.error?.code ?? 0) === 100;

    if (attempt.redirectUri && isRedirectUriIssue) {
      console.log(`[FB-OAuth-Token] attempt failed, will retry without redirect_uri. message=${message}`);
      continue;
    }

    return { ok: false, message };
  }

  return { ok: false, message: "Meta rejected the code." };
}

export interface PageInfo {
  id: string;
  name: string;
  /**
   * The Instagram Business account linked to this Page, when it has one.
   * Requested as part of /me/accounts discovery so a single call already shows
   * which Page owns a linked IG account without a per-Page round trip.
   */
  instagram?: { id: string; username: string };
}

type RawPage = {
  id: string;
  name: string;
  instagram_business_account?: { id?: string; username?: string } | null;
};

function toInstagram(
  value?: RawPage["instagram_business_account"],
): { id: string; username: string } | null {
  const id = value?.id?.trim();
  const username = value?.username?.trim();
  return id && username ? { id, username } : null;
}

export interface DiscoverPageOptions {
  /**
   * When true, only a Page that has a linked Instagram Business account is
   * accepted and the FIRST such Page is selected. When false (the default,
   * used by the plain Facebook connect flow) any managed Page works, so the
   * first Page in the list is used — IG linkage is reported but not required.
   */
  requireInstagram?: boolean;
}

/**
 * Reads the owner's Facebook Pages (me/accounts) and selects one.
 *
 * Every Page's `instagram_business_account{id,username}` is requested
 * up-front, so discovering the first Page that actually has a linked
 * Instagram Business account costs no extra round trip. This replaces the old
 * behaviour of blindly using the first Page in the list, which picked the
 * wrong Page (one with NO linked IG) for owners who manage several Pages.
 */
export async function discoverPage(
  accessToken: string,
  options: DiscoverPageOptions = {},
): Promise<{ ok: true; page: PageInfo } | { ok: false; message: string }> {
  const cfg = getMetaAppConfig();
  if (!cfg) return { ok: false, message: "Meta not configured." };

  const url = new URL(`${cfg.graphApiBase}/me/accounts`);
  url.searchParams.set("fields", "id,name,instagram_business_account{id,username}");
  url.searchParams.set("access_token", accessToken);

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (e) {
    console.log("[FB-OAuth-Page] FETCH ERROR:", e);
    return { ok: false, message: "Could not reach Meta." };
  }

  let json: {
    data?: Array<RawPage>;
    error?: { message?: string };
  };
  try {
    json = (await res.json()) as typeof json;
  } catch (e) {
    console.log("[FB-OAuth-Page] JSON PARSE ERROR:", e);
    return { ok: false, message: "Unexpected response from Meta." };
  }

  console.log("[FB-OAuth-Page] HTTP status:", res.status);
  console.log("[FB-OAuth-Page] data_count:", (json.data ?? []).length);
  if (json.error) console.log("[FB-OAuth-Page] error:", JSON.stringify(json.error));

  const pages = (json.data ?? []).filter(
    (p): p is RawPage => Boolean(p.id && p.name),
  );
  if (pages.length === 0) {
    return {
      ok: false,
      message:
        json.error?.message ??
        "No Facebook Page found. You need a Facebook Page to continue.",
    };
  }

  const describe = (page: RawPage) => {
    const ig = toInstagram(page.instagram_business_account);
    return ig
      ? `${page.name} (has linked IG @${ig.username})`
      : `${page.name} (no linked IG)`;
  };

  // Iterate ALL managed Pages and pick the first one that actually has a
  // linked Instagram Business account — never settle for the first Page.
  if (options.requireInstagram) {
    const firstWithInstagram = pages.find(
      (page) => toInstagram(page.instagram_business_account) !== null,
    );
    if (!firstWithInstagram) {
      console.log(
        `[FB-OAuth-Page] Rejected: no Page has a linked Instagram Business account. pages=${pages
          .map(describe)
          .join(", ")}`,
      );
      return {
        ok: false,
        message:
          "No Instagram Business account is linked to any of your Facebook Pages. Connect your Instagram Business account to a Page in Meta's settings, then reconnect.",
      };
    }

    const skipped = pages
      .filter((page) => page.id !== firstWithInstagram.id)
      .map(describe)
      .join(", ");
    console.log(
      `[FB-OAuth-Page] Selected page: ${describe(firstWithInstagram)}; skipped: ${
        skipped || "none"
      }`,
    );

    return {
      ok: true,
      page: {
        id: firstWithInstagram.id,
        name: firstWithInstagram.name,
        instagram:
          toInstagram(firstWithInstagram.instagram_business_account) ?? undefined,
      },
    };
  }

  // Plain Facebook connect: any managed Page works, take the first one and
  // report IG linkage so the caller and logs stay descriptive.
  const firstPage = pages[0];
  const skipped = pages
    .filter((page) => page.id !== firstPage.id)
    .map(describe)
    .join(", ");
  console.log(
    `[FB-OAuth-Page] Selected page: ${describe(firstPage)}; skipped: ${
      skipped || "none"
    }`,
  );

  return {
    ok: true,
    page: {
      id: firstPage.id,
      name: firstPage.name,
      instagram:
        toInstagram(firstPage.instagram_business_account) ?? undefined,
    },
  };
}

export interface InstagramInfo {
  id: string;
  username: string;
}

/**
 * Reads the Instagram business account linked to ONE specific Facebook Page.
 * Returns the Page too so the caller can store both the IG id and the parent
 * page id.
 *
 * The OAuth callback prefers the one-shot /me/accounts discovery in
 * discoverPage({ requireInstagram: true }) which already resolves the correct
 * Page with a linked IG account; this helper remains for callers that hold a
 * pageId and want to verify that single Page's IG linkage.
 */
export async function discoverInstagram(
  accessToken: string,
  pageId: string,
): Promise<
  { ok: true; instagram: InstagramInfo; pageId: string } | { ok: false; message: string; pageId?: string }
> {
  const cfg = getMetaAppConfig();
  if (!cfg) return { ok: false, message: "Meta not configured." };

  const pageUrl = new URL(`${cfg.graphApiBase}/${pageId}`);
  pageUrl.searchParams.set("fields", "id,instagram_business_account{id,username}");
  pageUrl.searchParams.set("access_token", accessToken);

  let res: Response;
  try {
    res = await fetch(pageUrl.toString());
  } catch (e) {
    console.log("[FB-OAuth-IG] FETCH ERROR:", e);
    return { ok: false, message: "Could not reach Meta." };
  }

  let json: {
    id?: string;
    instagram_business_account?: { id?: string; username?: string };
    error?: { message?: string };
  };
  try {
    json = (await res.json()) as typeof json;
  } catch (e) {
    console.log("[FB-OAuth-IG] JSON PARSE ERROR:", e);
    return { ok: false, message: "Unexpected response from Meta." };
  }

  console.log("[FB-OAuth-IG] HTTP status:", res.status);
  console.log("[FB-OAuth-IG] has_ig:", !!json.instagram_business_account?.id);
  if (json.error) console.log("[FB-OAuth-IG] error:", JSON.stringify(json.error));

  const ig = json.instagram_business_account;
  if (!ig?.id || !ig.username) {
    return {
      ok: false,
      message:
        json.error?.message ??
        "No Instagram business account is linked to this Facebook Page.",
      pageId,
    };
  }

  return {
    ok: true,
    pageId,
    instagram: { id: ig.id, username: ig.username },
  };
}
