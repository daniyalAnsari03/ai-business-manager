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
 *      Page's `access_token` AND its linked Instagram Business account, and
 *      selects the FIRST Page that actually has a linked Instagram Business
 *      account (a plain Facebook connect accepts any Page). Meta does not
 *      reliably return the nested `instagram_business_account` edge from
 *      /me/accounts, so each Page that lacks the edge is probed directly on
 *      the Page node (GET /{page-id}?fields=instagram_business_account), the
 *      method Meta's "Instagram API with Facebook Login" guide documents —
 *      first with the Page's own access token, then with the user access token.
 *      The right account_label and external ids can then be persisted.
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
  instagram?: InstagramIdentity;
}

type RawPage = {
  id: string;
  name: string;
  /**
   * The Page-scoped access token /me/accounts returns for THIS Page when its
   * `access_token` field is requested (it is — see discoverPage). The Page-node
   * `instagram_business_account` lookup tries this Page token first and falls
   * back to the user access token that the Meta docs use for the same request.
   */
  access_token?: string;
  instagram_business_account?: { id?: string; username?: string } | null;
};

export interface InstagramIdentity {
  id: string;
  username?: string;
}

/**
 * Returns the linked Instagram identity when the Page carries an
 * instagram_business_account id, or null when the Page has no linked
 * Instagram Business account.
 *
 * `username` is intentionally optional: Meta does not always include it on the
 * Page edge — the nested `instagram_business_account{id,username}` expansion
 * can legitimately return only the `id`. Requiring BOTH fields used to make
 * the connect flow reject Pages that ARE linked to a real Instagram account
 * (precisely the production failure when connecting @dinsbydaniyal), so
 * selection keys on the presence of `id` and the username is resolved
 * separately (or left out) when Meta omits it.
 */
function toInstagram(
  value?: RawPage["instagram_business_account"],
): InstagramIdentity | null {
  const id = value?.id?.trim();
  if (!id) return null;
  const username = value?.username?.trim();
  return username ? { id, username } : { id };
}

/**
 * Best-effort resolution of a linked Instagram account's username when the
 * discovery payload did not include it. The account is already trusted by its
 * `id` — the username is only the display label — so any failure here keeps
 * the identity (and never blocks the connection).
 */
async function resolveInstagramUsername(
  cfg: MetaAppConfig,
  accessToken: string,
  identity: InstagramIdentity,
): Promise<InstagramIdentity> {
  if (identity.username) return identity;
  const url = new URL(`${cfg.graphApiBase}/${identity.id}`);
  url.searchParams.set("fields", "username");
  url.searchParams.set("access_token", accessToken);
  try {
    const res = await fetch(url.toString());
    const json = (await res.json()) as {
      username?: string;
      error?: { message?: string };
    };
    if (res.ok && json.username?.trim()) {
      return { id: identity.id, username: json.username.trim() };
    }
  } catch {
    // Username is cosmetic; never fail the connection over it.
  }
  return identity;
}

/**
 * Best-effort redaction so raw Meta payloads can be logged without leaking the
 * access token that travels inside a request/response object.
 */
function redactToken(value: string): string {
  try {
    return value.replace(
      /access_token=[^&"\s]+/gi,
      "access_token=<redacted>",
    );
  } catch {
    return "<unloggable>";
  }
}

/** Strips any `access_token` property from a parsed Graph API JSON body. */
function redactBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactBody);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key === "access_token") {
        out[key] = "<redacted>";
      } else if (val && typeof val === "object") {
        out[key] = redactBody(val);
      } else {
        out[key] = val;
      }
    }
    return out;
  }
  return value;
}

/**
 * Logs the FULL raw Graph API response body (token-redacted) for one discovery
 * hop. The production reconnect failure was diagnosed from logs that only said
 * `ig_present=false` — Meta's response can carry an embedded `error` (HTTP 200
 * is not "success" for field-level failures: `{"error": {...}}` bodies, or a
 * field silently omitted because the token lacks the underlying permission).
 * Never reduce a live response to a boolean; keep the raw shape in the runtime
 * record so the next report is evidence, not inference.
 */
function logRawMetaResponse(
  tag: string,
  url: string,
  status: number,
  body: unknown,
): void {
  const raw = JSON.stringify(redactBody(body));
  const payload = raw && raw.length > 2000 ? `${raw.slice(0, 2000)}…<truncated>` : raw;
  console.log(
    `[FB-OAuth-Diag] ${tag} url=${redactToken(url)} HTTP_status=${status} raw_body=${payload ?? "null"}`,
  );
}

interface MetaEmbeddedError {
  message?: string;
  type?: string;
  code?: number;
}

/**
 * Probes ONE Page node for its linked Instagram Business account using the
 * given token. The request is the Meta-documented plain field shape
 * `fields=id,instagram_business_account` (Instagram API with Facebook Login →
 * "Get started 5. Get the Page's Instagram Business Account"). The plain shape
 * is used deliberately: nested `{id,username}` expansions were tried on
 * earlier deployments and returned the same empty edge; the current documented
 * response shape is a bare `{id}` object that never requires sub-field
 * expansion.
 *
 * The FULL raw response body and any embedded Meta `error` are logged so the
 * runtime record distinguishes "Meta returned the field absent because it
 * stopped exposing the linkage" from "Meta returned an explicit error" from
 * "the probe crashed". `metaError` is surfaced to the caller so the final
 * rejection can say WHY, instead of a flat "no linked IG".
 */
type PageProbeResult =
  | { ok: true; ig: InstagramIdentity }
  | {
      ok: false;
      probeAttempted: boolean;
      probeStatus?: number;
      metaError?: MetaEmbeddedError;
    };

async function probePageForInstagram(
  cfg: MetaAppConfig,
  pageId: string,
  token: string,
  tokenKind: "page" | "user",
): Promise<PageProbeResult> {
  const pageUrl = new URL(`${cfg.graphApiBase}/${pageId}`);
  pageUrl.searchParams.set("fields", "id,instagram_business_account");
  pageUrl.searchParams.set("access_token", token);
  try {
    const probe = await fetch(pageUrl.toString());
    const body = (await probe.json()) as {
      instagram_business_account?: {
        id?: string;
        username?: string;
      } | null;
      error?: MetaEmbeddedError;
    };
    logRawMetaResponse("page-node probe body", pageUrl.toString(), probe.status, body);
    const igPresent =
      body.instagram_business_account !== null &&
      body.instagram_business_account !== undefined;
    const embeddedError = body.error?.message
      ? `${body.error.code ?? "?"} ${body.error.type ?? ""} ${body.error.message}`.trim()
      : "none";
    console.log(
      `[FB-OAuth-Diag] page-node probe id=${pageId} token=${tokenKind} HTTP_status=${
        probe.status
      } ig_present=${igPresent} ig_id=${
        body.instagram_business_account?.id ?? "none"
      } ig_username=${
        body.instagram_business_account?.username ?? "none"
      } meta_error=${embeddedError}`,
    );
    const probed = probe.ok
      ? toInstagram(body.instagram_business_account)
      : null;
    if (probed) {
      console.log(
        `[FB-OAuth-Diag] page-node probe FOUND linked IG page_id=${pageId} token=${tokenKind} ig_id=${probed.id} ig_username=${probed.username ?? "none"}`,
      );
      return { ok: true, ig: probed };
    }
    return {
      ok: false,
      probeAttempted: true,
      probeStatus: probe.status,
      metaError: body.error,
    };
  } catch (e) {
    console.log(
      `[FB-OAuth-Diag] page-node probe EXCEPTION id=${pageId} token=${tokenKind} error=${String(e)}`,
    );
    return { ok: false, probeAttempted: false };
  }
}

/**
 * Best-effort introspection of the granted permissions on the runtime user
 * access token via Meta's `/debug_token` endpoint (app-secret authenticated,
 * server-side only). The single most common silent cause of a MISSING
 * `instagram_business_account` field with HTTP 200 is that the runtime token
 * does not actually carry the underlying Instagram permission (e.g.
 * `instagram_basic` was never granted to this app/login, or was silently
 * reduced). Only the names of the granted scopes are logged — the token and
 * app secret never reach the log.
 */
async function introspectTokenScopes(
  cfg: MetaAppConfig,
  userAccessToken: string,
): Promise<{ scopes?: string[]; error?: string }> {
  const url = new URL(`${cfg.graphApiBase}/debug_token`);
  url.searchParams.set("input_token", userAccessToken);
  url.searchParams.set("access_token", `${cfg.appId}|${cfg.appSecret}`);
  try {
    const res = await fetch(url.toString());
    const body = (await res.json()) as {
      data?: { scopes?: string[]; expires_at?: number };
      error?: MetaEmbeddedError;
    };
    // The debug_token URL embeds BOTH secrets (app id|secret as access_token
    // and the user's token as input_token); never log it. Log only the parsed
    // body, which carries the scope list.
    logRawMetaResponse(
      "debug_token introspection body",
      `${cfg.graphApiBase}/debug_token`,
      res.status,
      body,
    );
    if (res.ok && Array.isArray(body.data?.scopes)) {
      const scopes = body.data.scopes;
      const hasInstagramBasic = scopes.includes("instagram_basic");
      const hasPagesRead = scopes.includes("pages_read_engagement");
      const hasPagesList = scopes.includes("pages_show_list");
      console.log(
        `[FB-OAuth-Diag] token scopes count=${scopes.length} instagram_basic=${hasInstagramBasic} pages_read_engagement=${hasPagesRead} pages_show_list=${hasPagesList} scopes=${JSON.stringify(
          scopes,
        )}`,
      );
      return { scopes };
    }
    return {
      error: body.error?.message
        ? `${body.error.code ?? "?"} ${body.error.type ?? ""} ${body.error.message}`.trim()
        : `HTTP ${res.status}`,
    };
  } catch (e) {
    return { error: String(e) };
  }
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
 * Every Page's `access_token` and `instagram_business_account` (plain field,
 * no nested expansion) are requested up-front on /me/accounts, and each Page
 * that Meta returns WITHOUT a linked IG id is probed directly on its Page node
 * (the documented way to read a Page's linked Instagram account) before being
 * declared to have no linked IG. This replaces the old behaviour of relying
 * solely on the nested edge (Meta often omits it from /me/accounts for Pages
 * that ARE linked to Instagram) and of blindly using the first Page, which
 * picked the wrong Page (one with NO linked IG) for owners who manage several
 * Pages.
 */
export async function discoverPage(
  accessToken: string,
  options: DiscoverPageOptions = {},
): Promise<{ ok: true; page: PageInfo } | { ok: false; message: string }> {
  const cfg = getMetaAppConfig();
  if (!cfg) {
    console.log("[FB-OAuth-Page] SKIPPED: Meta not configured.");
    return { ok: false, message: "Meta not configured." };
  }

  // The exact field set Meta documents for "Instagram API with Facebook Login"
  // (Facebook Login for Business): each Page comes with its OWN Page access
  // token AND the linked Instagram Business account id. `access_token` is NOT
  // returned unless requested — omitting it makes every Runtime probe below
  // silently skip (reason=no_page_access_token), which is exactly why commit
  // d653cf3 changed nothing in production. The `instagram_business_account`
  // field is requested PLAIN (no {id,username} expansion): Meta drops the whole
  // edge (HTTP 200, no error) when the requested subfields cannot be resolved,
  // and the documented shape of the field is just `{id}` — the username is
  // resolved separately from the IG User node.
  const url = new URL(`${cfg.graphApiBase}/me/accounts`);
  url.searchParams.set(
    "fields",
    "id,name,access_token,instagram_business_account",
  );
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

  logRawMetaResponse("me/accounts response body", url.toString(), res.status, json);
  console.log("[FB-OAuth-Page] HTTP status:", res.status);
  console.log("[FB-OAuth-Page] data_count:", (json.data ?? []).length);
  if (json.error) console.log("[FB-OAuth-Page] error:", JSON.stringify(json.error));

  const pages = (json.data ?? []).filter(
    (p): p is RawPage => Boolean(p.id && p.name),
  );
  for (const p of pages) {
    console.log(
      `[FB-OAuth-Diag] /me/accounts page id=${p.id} name=${JSON.stringify(
        p.name,
      )} nested_ig=${toInstagram(p.instagram_business_account)?.id ?? "none"}`,
    );
  }
  if (pages.length === 0) {
    return {
      ok: false,
      message:
        json.error?.message ??
        "No Facebook Page found. You need a Facebook Page to continue.",
    };
  }

  const describe = (page: RawPage, igOverride?: InstagramIdentity | null) => {
    const ig =
      igOverride !== undefined
        ? igOverride
        : toInstagram(page.instagram_business_account);
    if (!ig) return `${page.name} (no linked IG)`;
    return ig.username
      ? `${page.name} (has linked IG @${ig.username})`
      : `${page.name} (has linked IG account ${ig.id})`;
  };

  // Root cause of the still-failing production reconnect (September 2026) —
  // live runtime evidence, deployment dpl_Gv84stPzHPAw5Vz7HcSHHfjNTw5A
  // (commit 89dbef5) of ai-business-manager-three.vercel.app, 2026-09-05T19:38:
  //
  // 1. Commit d653cf3 switched the Page-node probe to the Page's own access
  //    token, but the /me/accounts request never asked Meta for `access_token`
  //    — so every Page arrived WITHOUT its token and the probe was never
  //    attempted (proven in the d653cf3 deployment logs:
  //    `reason=no_page_access_token`, `probe_attempted=no`).
  // 2. Commit 89dbef5 fixed that (requested `access_token` + the plain
  //    `instagram_business_account` field). The live logs PROVE the new branch
  //    executed: all three Pages (`D&N Collection`, `mr_dani__03`,
  //    `Hafiz daniyal ansari`) were probed with BOTH their Page token AND the
  //    user token, every probe returned **HTTP 200**, and every probe came back
  //    `ig_present=false` — Meta did not return the `instagram_business_account`
  //    field for ANY Page in this token/app context. So the request-shape fixes
  //    changed the request but not the outcome; Meta's current API simply does
  //    not expose a linked IG account for this login's Pages.
  // 3. The defect that REMAINED in the code: each probe discarded the raw Meta
  //    response, keeping only a boolean. An HTTP 200 with an absent field is
  //    ambiguous — it can be a genuinely unlinked Page, a silently-dropped
  //    permission field (`instagram_basic` not actually granted at runtime), an
  //    embedded `{"error": {...}}` body, or a Page edge Meta no longer emits.
  //    The code could not distinguish any of these, so every real reconnect
  //    produced the same dead-end rejection with zero runtime evidence of WHY.
  //
  // Current Meta behaviour (verified against the live API in this deployment
  // and the June 2026 "Instagram API with Facebook Login – Get started" doc):
  //   - the documented discovery remains
  //     GET /{page-id}?fields=instagram_business_account (plain shape), and
  //   - the field is only emitted when the runtime token actually carries the
  //     underlying Instagram/Page permission for that Page.
  //
  // Correct handling implemented here:
  //   - GET /me/accounts?fields=id,name,access_token,instagram_business_account
  //   - each Page that still lacks the linked IG id is probed on its own node:
  //     GET /{page-id}?fields=id,instagram_business_account — Page token first,
  //     user token fallback (the shape Meta's Get Started guide documents).
  //   - the FULL raw response of every hop (token-redacted) is logged, any
  //     embedded Meta `error` is surfaced in the rejection line, and the
  //     failure path introspects the runtime token's granted scopes via
  //     /debug_token — so the real cause is in the runtime record, never a
  //     guessed boolean.
  //   - selection keys on a valid `instagram_business_account.id`; `username`
  //     is resolved separately from the IG User node and stays optional.
  type LinkedInstagramResult =
    | { ok: true; ig: InstagramIdentity }
    | {
        ok: false;
        nestedPresent: boolean;
        probeAttempted: boolean;
        probeStatus?: number;
        metaError?: MetaEmbeddedError;
      };

  /**
   * Reads one Page's linked Instagram Business account. The Page's /me/accounts
   * entry may already carry the nested id; otherwise the Page node is probed —
   * first with the Page's OWN access token (the /me/accounts value), then with
   * the user access token as the documented fallback when the two differ.
   * Selection keys on a valid `instagram_business_account.id`.
   */
  const linkedInstagram = async (
    page: RawPage,
  ): Promise<LinkedInstagramResult> => {
    const nested = toInstagram(page.instagram_business_account);
    if (nested) return { ok: true, ig: nested };

    const pageToken = page.access_token?.trim();
    if (!pageToken) {
      console.log(
        `[FB-OAuth-Diag] candidate skipped function=discoverPage branch=requireInstagram page_id=${page.id} name=${JSON.stringify(
          page.name,
        )} reason=no_page_access_token`,
      );
      return { ok: false, nestedPresent: false, probeAttempted: false };
    }

    const attempts: Array<{ token: string; kind: "page" | "user" }> = [
      { token: pageToken, kind: "page" },
    ];
    if (accessToken.trim() !== pageToken) {
      attempts.push({ token: accessToken, kind: "user" });
    }

    let probeStatus: number | undefined;
    let probeAttempted = false;
    let metaError: MetaEmbeddedError | undefined;
    for (const attempt of attempts) {
      const probe = await probePageForInstagram(
        cfg,
        page.id,
        attempt.token,
        attempt.kind,
      );
      if (probe.ok) {
        console.log(
          `[FB-OAuth-Page] Page node probe found linked IG for ${page.name}`,
        );
        return { ok: true, ig: probe.ig };
      }
      if (probe.probeAttempted) {
        probeAttempted = true;
        probeStatus = probe.probeStatus;
      }
      if (probe.metaError) metaError = probe.metaError;
    }
    return {
      ok: false,
      nestedPresent: false,
      probeAttempted,
      probeStatus,
      metaError,
    };
  };

  // Iterate ALL managed Pages and pick the first one that actually has a
  // linked Instagram Business account — never settle for the first Page.
  // Selection keys on the linked IG `id` (not on a possibly-absent username),
  // and the username is resolved separately when Meta omits it.
  if (options.requireInstagram) {
    for (const rawPage of pages) {
      const result = await linkedInstagram(rawPage);
      if (!result.ok) {
        console.log(
          `[FB-OAuth-Diag] candidate rejected function=discoverPage branch=requireInstagram page_id=${rawPage.id} name=${JSON.stringify(
            rawPage.name,
          )} reason=no_linked_ig nested_ig=${
            result.nestedPresent ? "yes" : "no"
          } probe_attempted=${result.probeAttempted ? "yes" : "no"} probe_http=${
            result.probeStatus ?? "n/a"
          } meta_error=${
            result.metaError?.message
              ? `${result.metaError.code ?? "?"} ${result.metaError.type ?? ""} ${result.metaError.message}`.trim()
              : "none"
          }`,
        );
        continue;
      }

      const resolved = await resolveInstagramUsername(
        cfg,
        accessToken,
        result.ig,
      );
      console.log(
        `[FB-OAuth-Diag] discovered IG account page_id=${rawPage.id} ig_id=${result.ig.id} ig_username=${result.ig.username ?? "none"}`,
      );
      const skipped = pages
        .filter((page) => page.id !== rawPage.id)
        .map((page) => describe(page))
        .join(", ");
      console.log(
        `[FB-OAuth-Diag] SELECTED page_id=${rawPage.id} name=${JSON.stringify(
          rawPage.name,
        )} ig_id=${resolved.id} ig_username=${resolved.username ?? "none"}`,
      );
      console.log(
        `[FB-OAuth-Page] Selected page: ${describe(
          rawPage,
          resolved,
        )}; skipped: ${skipped || "none"}`,
      );

      return {
        ok: true,
        page: {
          id: rawPage.id,
          name: rawPage.name,
          instagram: resolved,
        },
      };
    }

    console.log(
      `[FB-OAuth-Page] Rejected: no Page has a linked Instagram Business account. pages=${pages
        .map((page) => describe(page))
        .join(", ")}`,
    );
    // Final evidence hop: introspect the runtime user token's granted scopes.
    // A silent field absence with HTTP 200 is most often caused by the token
    // lacking the underlying Instagram permission (e.g. `instagram_basic` not
    // actually granted by this login/app). Logging the granted scope list is
    // the only way to prove at runtime whether that is the cause; the token and
    // app secret never reach the log.
    const introspection = await introspectTokenScopes(cfg, accessToken);
    if (introspection.error) {
      console.log(
        `[FB-OAuth-Diag] token scope introspection FAILED error=${introspection.error}`,
      );
    }
    return {
      ok: false,
      message:
        "No Instagram Business account is linked to any of your Facebook Pages. Connect your Instagram Business account to a Page in Meta's settings, then reconnect.",
    };
  }

  // Plain Facebook connect: any managed Page works, take the first one and
  // report IG linkage so the caller and logs stay descriptive.
  const firstPage = pages[0];
  const skipped = pages
    .filter((page) => page.id !== firstPage.id)
    .map((page) => describe(page))
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
  username?: string;
}

/**
 * Resolves the Page-scoped access token for `pageId` from /me/accounts — the
 * token Meta's "Facebook Login for Business" guide says to capture alongside a
 * Page's linked Instagram Business account. Best-effort: returns null when the
 * user token cannot list Pages or the id is not among them. Callers fall back
 * to the user access token for the Page-node lookup when it is unavailable.
 */
async function resolvePageAccessToken(
  cfg: MetaAppConfig,
  userAccessToken: string,
  pageId: string,
): Promise<string | null> {
  try {
    const url = new URL(`${cfg.graphApiBase}/me/accounts`);
    url.searchParams.set("fields", "id,access_token");
    url.searchParams.set("access_token", userAccessToken);
    const res = await fetch(url.toString());
    const json = (await res.json()) as {
      data?: Array<{ id?: string; access_token?: string }>;
      error?: { message?: string };
    };
    if (!res.ok || !Array.isArray(json.data)) {
      console.log(
        `[FB-OAuth-IG] page access token lookup failed pageId=${pageId} error=${
          json.error?.message ?? `HTTP ${res.status}`
        }`,
      );
      return null;
    }
    const page = json.data.find((p) => p.id === pageId);
    const token = page?.access_token?.trim();
    if (!token) {
      console.log(
        `[FB-OAuth-IG] no page access token for pageId=${pageId}`,
      );
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

/**
 * Reads the Instagram business account linked to ONE specific Facebook Page.
 * Returns the Page too so the caller can store both the IG id and the parent
 * page id.
 *
 * The OAuth callback prefers the one-shot /me/accounts discovery in
 * discoverPage({ requireInstagram: true }) which already resolves the correct
 * Page with a linked IG account; this helper remains for callers that hold a
 * pageId and want to verify that single Page's IG linkage. Like discoverPage's
 * Page-node probe, it requests the plain `instagram_business_account` field and
 * tries the Page's own access token (resolved from /me/accounts) first, then
 * the user access token.
 */
export async function discoverInstagram(
  accessToken: string,
  pageId: string,
): Promise<
  { ok: true; instagram: InstagramInfo; pageId: string } | { ok: false; message: string; pageId?: string }
> {
  const cfg = getMetaAppConfig();
  if (!cfg) return { ok: false, message: "Meta not configured." };

  // The /me/accounts Page access token is the token Meta's "Facebook Login for
  // Business" guide says to capture for Page-scoped IG access; read it first
  // and fall back to the user access token that the "Get Started" guide uses
  // for the same Page-node request.
  const pageToken = await resolvePageAccessToken(cfg, accessToken, pageId);

  const attempts: Array<{ token: string; kind: "page" | "user" }> = [];
  if (pageToken) attempts.push({ token: pageToken, kind: "page" });
  if (!pageToken || pageToken !== accessToken.trim()) {
    attempts.push({ token: accessToken, kind: "user" });
  }

  for (const attempt of attempts) {
    const probe = await probePageForInstagram(
      cfg,
      pageId,
      attempt.token,
      attempt.kind,
    );
    if (probe.ok) {
      const resolved = await resolveInstagramUsername(
        cfg,
        accessToken,
        probe.ig,
      );
      return { ok: true, pageId, instagram: resolved };
    }
  }

  return {
    ok: false,
    message: pageToken
      ? "No Instagram business account is linked to this Facebook Page."
      : "This Facebook Page could not be verified for an Instagram Business account.",
    pageId,
  };
}
