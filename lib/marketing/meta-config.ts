/**
 * Server-side Meta (Facebook / Instagram) developer-app configuration.
 *
 * These values MUST stay server-only. META_APP_SECRET in particular is a
 * private credential that must never reach the browser. When the app is not
 * configured the OAuth connect flow degrades honestly (returns null) so the
 * UI never pretends a connection happened.
 */

const GRAPH_API_BASE = "https://graph.facebook.com/v25.0";
const INSTAGRAM_GRAPH_API_BASE = "https://graph.instagram.com/v21.0";
const DIALOG_OAUTH_BASE = "https://www.facebook.com/v25.0/dialog/oauth";
const INSTAGRAM_OAUTH_BASE = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";

export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  graphApiBase: string;
  instagramGraphApiBase: string;
  dialogOauthBase: string;
  instagramOauthBase: string;
  instagramTokenUrl: string;
  instagramAppId?: string;
  instagramAppSecret?: string;
  facebookConfigId?: string;
}

/**
 * Resolves the Meta developer-app config, or null when the app is not set up.
 * Callers use null to disable the connect flow honestly.
 */
export function getMetaAppConfig(): MetaAppConfig | null {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  const facebookConfigId = process.env.META_FACEBOOK_CONFIG_ID?.trim() || undefined;
  const instagramAppId = process.env.META_INSTAGRAM_APP_ID?.trim() || undefined;
  const instagramAppSecret = process.env.META_INSTAGRAM_APP_SECRET?.trim() || undefined;
  return {
    appId,
    appSecret,
    graphApiBase: GRAPH_API_BASE,
    instagramGraphApiBase: INSTAGRAM_GRAPH_API_BASE,
    dialogOauthBase: DIALOG_OAUTH_BASE,
    instagramOauthBase: INSTAGRAM_OAUTH_BASE,
    instagramTokenUrl: INSTAGRAM_TOKEN_URL,
    instagramAppId,
    instagramAppSecret,
    facebookConfigId,
  };
}

/** Whether a real Meta app is configured (server-only). */
export function isMetaConfigured(): boolean {
  return getMetaAppConfig() !== null;
}
