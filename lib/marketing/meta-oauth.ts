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
 *   5. discoverPage() / discoverInstagram() read the owner's Page (and the
 *      Instagram business account linked to it) so the right account_label
 *      and external ids can be persisted.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getMetaAppConfig, type MetaAppConfig } from "@/lib/marketing/meta-config";

export const SUPPORTED_OAUTH_PLATFORMS = ["instagram", "facebook"] as const;
export type OAuthPlatform = (typeof SUPPORTED_OAUTH_PLATFORMS)[number];

export function isOAuthPlatform(value: string): value is OAuthPlatform {
  return (SUPPORTED_OAUTH_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Scopes required to read (and later publish to) each channel.
 *
 * 2026 note: The scopes differ by Meta product:
 *
 * - Instagram ("Instagram API with Instagram Login"):
 *     instagram_basic, instagram_content_publishing
 *   These are requested through www.instagram.com/oauth/authorize
 *   using the Instagram App ID (not the main Meta App ID).
 *   The scope names match the Meta dashboard's required permissions for
 *   this app's "Instagram API with Instagram Login" use case (no
 *   "business_" prefix) and match what already works for basic connect.
 *
 * - Facebook ("Facebook Login for Business"):
 *     pages_show_list, pages_read_engagement, business_management
 *   These are requested through facebook.com/dialog/oauth.
 *   When a Facebook Login for Business Configuration ID is provided
 *   (META_FACEBOOK_CONFIG_ID), the `config_id` parameter replaces `scope`
 *   entirely — the configuration defines which permissions are requested.
 *   `pages_manage_posts` is NOT used; the Configuration ID controls access.
 *
 * Instagram content scopes are NOT valid Facebook Login scopes and must
 * never appear in the Facebook OAuth URL.
 */
const PLATFORM_SCOPES: Record<OAuthPlatform, string> = {
  facebook: "pages_show_list,pages_read_engagement,business_management",
  instagram: "instagram_basic,instagram_content_publishing",
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
 * For Instagram ("Instagram API with Instagram Login"), the Instagram App ID
 * (META_INSTAGRAM_APP_ID) is used as client_id — NOT the main Meta App ID.
 * For Facebook with a Login for Business Configuration ID
 * (META_FACEBOOK_CONFIG_ID), the `config_id` parameter replaces `scope`.
 */
export function buildAuthorizeUrl(options: AuthorizeUrlOptions): string {
  const cfg = getMetaAppConfig();
  if (!cfg) {
    throw new Error("Meta is not configured; cannot build authorize URL.");
  }

  // Instagram content-publishing permissions belong to the "Instagram API with
  // Instagram Login" product and must be requested through Instagram's own
  // OAuth entry point.  Facebook Login's dialog/oauth does not recognise them.
  const oauthBase =
    options.platform === "instagram" ? cfg.instagramOauthBase : cfg.dialogOauthBase;

  const url = new URL(oauthBase);

  // Instagram OAuth requires the Instagram App ID, not the main Meta App ID.
  const clientId =
    options.platform === "instagram" && cfg.instagramAppId
      ? cfg.instagramAppId
      : cfg.appId;
  url.searchParams.set("client_id", clientId);
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
}

/** Reads the owner's Facebook Pages (me/accounts) and returns the first one. */
export async function discoverPage(
  accessToken: string,
): Promise<{ ok: true; page: PageInfo } | { ok: false; message: string }> {
  const cfg = getMetaAppConfig();
  if (!cfg) return { ok: false, message: "Meta not configured." };

  const url = new URL(`${cfg.graphApiBase}/me/accounts`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", accessToken);

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (e) {
    console.log("[FB-OAuth-Page] FETCH ERROR:", e);
    return { ok: false, message: "Could not reach Meta." };
  }

  let json: { data?: Array<{ id: string; name: string }>; error?: { message?: string } };
  try {
    json = (await res.json()) as typeof json;
  } catch (e) {
    console.log("[FB-OAuth-Page] JSON PARSE ERROR:", e);
    return { ok: false, message: "Unexpected response from Meta." };
  }

  console.log("[FB-OAuth-Page] HTTP status:", res.status);
  console.log("[FB-OAuth-Page] data_count:", (json.data ?? []).length);
  if (json.error) console.log("[FB-OAuth-Page] error:", JSON.stringify(json.error));

  const pages = (json.data ?? []).filter((p) => p.id && p.name);
  if (pages.length === 0) {
    return {
      ok: false,
      message:
        json.error?.message ??
        "No Facebook Page found. You need a Facebook Page to continue.",
    };
  }

  return {
    ok: true,
    page: { id: pages[0].id, name: pages[0].name },
  };
}

export interface InstagramInfo {
  id: string;
  username: string;
}

/**
 * Reads the Instagram business account linked to a Facebook Page. Returns the
 * Page too so the caller can store both the IG id and the parent page id.
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

/**
 * Exchanges the authorization code for a short-lived Instagram User Access
 * Token.  Instagram Login uses POST to api.instagram.com/oauth/access_token
 * (not the Graph API endpoint used by Facebook Login).
 */
export async function exchangeInstagramCodeForToken(
  code: string,
  redirectUri: string,
): Promise<
  { ok: true; accessToken: string; userId?: string; expiresIn?: number } | { ok: false; message: string }
> {
  const cfg = getMetaAppConfig();
  if (!cfg) return { ok: false, message: "Meta not configured." };

  const clientId = cfg.instagramAppId ?? cfg.appId;
  const clientSecret = cfg.instagramAppSecret ?? cfg.appSecret;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  let res: Response;
  try {
    res = await fetch(cfg.instagramTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (e) {
    console.log("[IG-OAuth-Token] FETCH ERROR:", e);
    return { ok: false, message: "Could not reach Instagram." };
  }

  let json: {
    access_token?: string;
    user_id?: string;
    expires_in?: number;
    error?: { message?: string; type?: string; code?: number };
  };
  try {
    json = (await res.json()) as typeof json;
  } catch (e) {
    console.log("[IG-OAuth-Token] JSON PARSE ERROR:", e);
    return { ok: false, message: "Unexpected response from Instagram." };
  }

  console.log(
    `[IG-OAuth-Token] HTTP status=${res.status} has_access_token=${!!json.access_token} expires_in=${json.expires_in}`,
  );
  if (json.error) console.log("[IG-OAuth-Token] error=", JSON.stringify(json.error));

  if (res.ok && json.access_token) {
    return {
      ok: true,
      accessToken: json.access_token,
      userId: json.user_id,
      expiresIn: json.expires_in,
    };
  }

  return { ok: false, message: json.error?.message ?? "Instagram rejected the code." };
}

export interface InstagramUserInfo {
  id: string;
  username: string;
  name?: string;
  account_type?: string;
}

/**
 * Reads the authenticated Instagram professional account's info via the
 * Instagram Graph API.  Returns the user ID and username directly — no
 * Facebook Page discovery is needed for Instagram Login.
 */
export async function discoverInstagramUser(
  accessToken: string,
): Promise<{ ok: true; user: InstagramUserInfo } | { ok: false; message: string }> {
  const cfg = getMetaAppConfig();
  if (!cfg) return { ok: false, message: "Meta not configured." };

  const url = new URL(`${cfg.instagramGraphApiBase}/me`);
  url.searchParams.set("fields", "id,username,name,account_type");
  url.searchParams.set("access_token", accessToken);

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (e) {
    console.log("[IG-OAuth-User] FETCH ERROR:", e);
    return { ok: false, message: "Could not reach Instagram." };
  }

  let json: {
    id?: string;
    username?: string;
    name?: string;
    account_type?: string;
    error?: { message?: string };
  };
  try {
    json = (await res.json()) as typeof json;
  } catch (e) {
    console.log("[IG-OAuth-User] JSON PARSE ERROR:", e);
    return { ok: false, message: "Unexpected response from Instagram." };
  }

  console.log("[IG-OAuth-User] HTTP status:", res.status);
  console.log("[IG-OAuth-User] has_user:", !!json.id);
  if (json.error) console.log("[IG-OAuth-User] error:", JSON.stringify(json.error));

  if (!json.id || !json.username) {
    return {
      ok: false,
      message: json.error?.message ?? "Could not retrieve Instagram account info.",
    };
  }

  return {
    ok: true,
    user: {
      id: json.id,
      username: json.username,
      name: json.name,
      account_type: json.account_type,
    },
  };
}
