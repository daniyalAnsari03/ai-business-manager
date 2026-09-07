import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/supabase/server";
import { getUserBusiness } from "@/lib/business/service";
import {
  verifyState,
  exchangeCodeForToken,
  discoverPage,
  resolveOAuthRedirectUri,
  resolveOAuthBaseUrl,
} from "@/lib/marketing/meta-oauth";
import { connectMetaAccount } from "@/lib/marketing/service";

export const dynamic = "force-dynamic";

const SETTINGS_PATH = "/dashboard/settings";

/**
 * OAuth callback from Facebook / Instagram. Verifies the returned signed
 * `state` against the authenticated session + business, exchanges the
 * `code` for an access token, discovers the connected Page / Instagram
 * account, persists the `connected_accounts` row and redirects back to
 * Marketing settings with a readable result. No raw tokens are ever
 * leaked to the client.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const fbError =
    url.searchParams.get("error_description") ??
    url.searchParams.get("error");

  const redirect = (query: string) => {
    // Always return the result on the canonical public origin
    // (META_OAUTH_REDIRECT_URL) rather than the request's own origin. The OAuth
    // callback arrives through the public tunnel (e.g. ngrok) even when the dev
    // server resolves request.url to localhost. Redirecting to that private
    // origin would trigger ERR_SSL_PROTOCOL_ERROR and leave the browser on a
    // different host than the session cookie's, making the connection look
    // unauthorized.
    const target = new URL(SETTINGS_PATH, resolveOAuthBaseUrl(url));
    target.search = query;
    return NextResponse.redirect(target.toString());
  };

  // Every step failure emits ONE dense, greppable line so the failing phase of
  // a real callback round trip is unambiguous in server logs.
  const failStep = (platform: string, step: string, detail: string) => {
    console.error(
      `[oauth/callback] FAIL platform=${platform} step=${step} message=${detail}`,
    );
    return redirect(`?connect=error&reason=${step}`);
  };

  if (fbError) {
    console.error(
      "[oauth/callback] Facebook denied. error:",
      fbError,
    );
    return redirect("?connect=denied");
  }
  if (!code || !stateRaw) {
    console.error(
      "[oauth/callback] Missing code or state — callback received no authorization data.",
    );
    return redirect("?connect=error");
  }

  const user = await getServerUser();
  if (!user) return redirect("?connect=unauthorized");
  const business = await getUserBusiness();
  if (!business) return redirect("?connect=unauthorized");

  const verified = verifyState(stateRaw);
  if (!verified.ok) {
    console.error("[oauth/callback] State verification failed:", verified.reason);
    return redirect(`?connect=error&reason=${verified.reason}`);
  }
  const { businessId, platform } = verified.state;
  if (businessId !== business.id) {
    console.error(
      "[oauth/callback] State business mismatch: state businessId=",
      businessId,
      "session businessId=",
      business.id,
    );
    return redirect("?connect=unauthorized");
  }

  const redirectUri = resolveOAuthRedirectUri(url);

  if (platform === "facebook") {
    const token = await exchangeCodeForToken(code, redirectUri);
    if (!token.ok) {
      return failStep(platform, "token", token.message);
    }

    const page = await discoverPage(token.accessToken);
    if (!page.ok) {
      return failStep(platform, "page", page.message);
    }

    const persisted = await connectMetaAccount({
      platform,
      accountLabel: page.page.name,
      // Real Page posts (feed/photos) MUST be signed with a PAGE-scoped token.
      // discoverPage already returns the Page's own access_token from
      // /me/accounts — prefer it over the user token the code exchange yields.
      accessToken: page.page.accessToken?.trim() || token.accessToken,
      tokenExpiresAt: token.expiresIn
        ? new Date(Date.now() + token.expiresIn * 1000).toISOString()
        : null,
      externalAccountId: page.page.id,
    });
    if (!persisted.ok) {
      return failStep(platform, "save", persisted.reason);
    }

    return redirect(`?connect=success&platform=facebook`);
  }

  // Instagram via "Instagram API with Facebook Login": the same Facebook Login
  // round trip as the facebook branch — exchange on graph.facebook.com, then
  // read the Instagram business account linked to the owner's Page. The token
  // and all IG publishing calls therefore share ONE app vault (the main Meta
  // App) and one host (graph.facebook.com).
  const igToken = await exchangeCodeForToken(code, redirectUri);
  if (!igToken.ok) {
    return failStep(platform, "token", igToken.message);
  }

  // Select the FIRST managed Page that actually has a linked Instagram
  // Business account — never settle for the first Page in the list, which is
  // how the wrong Page (one with NO linked IG) used to get picked.
  const igPage = await discoverPage(igToken.accessToken, { requireInstagram: true });
  if (!igPage.ok) {
    return failStep(platform, "instagram", igPage.message);
  }

  const igUser = igPage.page.instagram;
  if (!igUser) {
    // Defensive: requireInstagram above guarantees a linked IG account, but
    // never claim success without the ids that are about to be persisted.
    return failStep(
      platform,
      "instagram",
      "Selected Page has no Instagram Business account to persist.",
    );
  }

  const persisted = await connectMetaAccount({
    platform,
    accountLabel: igUser.username ?? igPage.page.name,
    accessToken: igToken.accessToken,
    tokenExpiresAt: igToken.expiresIn
      ? new Date(Date.now() + igToken.expiresIn * 1000).toISOString()
      : null,
    externalAccountId: igUser.id,
  });
  if (!persisted.ok) {
    return failStep(platform, "save", persisted.reason);
  }

  return redirect(`?connect=success&platform=instagram`);
}
