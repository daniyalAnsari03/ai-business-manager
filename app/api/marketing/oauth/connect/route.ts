import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/supabase/server";
import { getUserBusiness } from "@/lib/business/service";
import { isMetaConfigured } from "@/lib/marketing/meta-config";
import {
  buildAuthorizeUrl,
  isOAuthPlatform,
  resolveOAuthRedirectUri,
  type OAuthPlatform,
} from "@/lib/marketing/meta-oauth";

export const dynamic = "force-dynamic";

/**
 * Initiates the Meta OAuth connect flow for Instagram or Facebook. The caller
 * must be the authenticated owner of a business; that business is taken from
 * the verified server session (never from query params) and is bound into the
 * signed OAuth state. Returns the Facebook dialog URL the browser should
 * navigate to.
 */
export async function GET(request: Request) {
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const business = await getUserBusiness();
  if (!business) {
    return NextResponse.json({ error: "no_business" }, { status: 403 });
  }
  if (!isMetaConfigured()) {
    return NextResponse.json(
      { error: "meta_not_configured", message: "Meta accounts are not set up for this deployment yet." },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const platformParam = url.searchParams.get("platform");
  if (!platformParam || !isOAuthPlatform(platformParam)) {
    return NextResponse.json(
      { error: "invalid_platform", message: "Unsupported platform." },
      { status: 400 },
    );
  }
  const platform: OAuthPlatform = platformParam;

  const redirectUri = resolveOAuthRedirectUri(request.url);

  const authorizeUrl = buildAuthorizeUrl({
    platform,
    businessId: business.id,
    redirectUri,
  });

  return NextResponse.json({ url: authorizeUrl });
}
