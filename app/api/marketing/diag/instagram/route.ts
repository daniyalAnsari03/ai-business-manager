/**
 * Diagnostic endpoint for Instagram connection debugging.
 *
 * Implements the evidence-first approach from docs/fix.txt:
 * 1. Reads the stored Facebook connection's access token
 * 2. Calls GET /me/accounts?fields=id,name,instagram_business_account{id,username}
 * 3. If ig present: identifies bug in discoverPage()/discoverInstagram()
 * 4. If ig missing: probes GET /{page-id}?fields=instagram_business_account directly
 * 5. Checks token permissions via /debug_token
 *
 * Returns ALL raw Meta API responses for evidence-based diagnosis.
 */

import { NextResponse } from "next/server";
import { getServerUser, getSupabaseServerClient } from "@/lib/supabase/server";
import { getUserBusiness } from "@/lib/business/service";
import { getMetaAppConfig } from "@/lib/marketing/meta-config";

export const dynamic = "force-dynamic";

interface DiagResult {
  businessId: string;
  facebookAccountId: string | null;
  facebookAccountLabel: string | null;
  steps: Record<string, unknown>;
  conclusion: string;
}

export async function GET(request: Request) {
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const business = await getUserBusiness();
  if (!business) {
    return NextResponse.json({ error: "no_business" }, { status: 400 });
  }

  const cfg = getMetaAppConfig();
  if (!cfg) {
    return NextResponse.json({ error: "Meta not configured" }, { status: 500 });
  }

  const supabase = await getSupabaseServerClient();

  // Read the stored Facebook connection
  const { data: fbRow, error: fbErr } = await supabase
    .from("connected_accounts")
    .select("id, platform, status, account_label, access_token, external_account_id, token_expires_at")
    .eq("business_id", business.id)
    .eq("platform", "facebook")
    .eq("status", "connected")
    .maybeSingle();

  if (fbErr || !fbRow) {
    return NextResponse.json({
      error: "No connected Facebook account found",
      detail: fbErr?.message ?? "row missing",
      businessId: business.id,
    }, { status: 404 });
  }

  const accessToken = (fbRow as { access_token: string }).access_token;
  if (!accessToken) {
    return NextResponse.json({
      error: "Facebook connection has no stored access_token",
      businessId: business.id,
    }, { status: 500 });
  }

  const steps: Record<string, unknown> = {};
  const graphBase = cfg.graphApiBase;

  // ── Step 1: GET /me/accounts with instagram_business_account ──
  try {
    const url = new URL(`${graphBase}/me/accounts`);
    url.searchParams.set("fields", "id,name,instagram_business_account{id,username}");
    url.searchParams.set("access_token", accessToken);

    const res = await fetch(url.toString());
    const body = await res.json();

    steps["step1_me_accounts"] = {
      url: url.toString().replace(/access_token=[^&]+/, "access_token=<redacted>"),
      httpStatus: res.status,
      raw: body,
    };
  } catch (e) {
    steps["step1_me_accounts"] = { error: String(e) };
  }

  // ── Step 2: Check which Page is the stored external_account_id ──
  const storedPageId = (fbRow as { external_account_id: string }).external_account_id;

  // ── Step 3: Direct Page node probe ──
  if (storedPageId) {
    try {
      const url = new URL(`${graphBase}/${storedPageId}`);
      url.searchParams.set("fields", "id,name,instagram_business_account");
      url.searchParams.set("access_token", accessToken);

      const res = await fetch(url.toString());
      const body = await res.json();

      steps["step3_page_node_probe"] = {
        url: url.toString().replace(/access_token=[^&]+/, "access_token=<redacted>"),
        pageId: storedPageId,
        httpStatus: res.status,
        raw: body,
      };
    } catch (e) {
      steps["step3_page_node_probe"] = { error: String(e), pageId: storedPageId };
    }
  }

  // ── Step 4: Token scope introspection via /debug_token ──
  try {
    const url = new URL(`${graphBase}/debug_token`);
    url.searchParams.set("input_token", accessToken);
    url.searchParams.set("access_token", `${cfg.appId}|${cfg.appSecret}`);

    const res = await fetch(url.toString());
    const body = await res.json();

    // Never expose the access_token or app secret in the response
    const safeBody = JSON.parse(JSON.stringify(body));
    if (safeBody.data) {
      delete safeBody.data.app_id;
      delete safeBody.data.type;
      delete safeBody.data.data_access_expires_at;
    }

    steps["step4_debug_token"] = {
      httpStatus: res.status,
      raw: safeBody,
    };
  } catch (e) {
    steps["step4_debug_token"] = { error: String(e) };
  }

  // ── Step 5: /me/permissions ──
  try {
    const url = new URL(`${graphBase}/me/permissions`);
    url.searchParams.set("access_token", accessToken);

    const res = await fetch(url.toString());
    const body = await res.json();

    steps["step5_me_permissions"] = {
      httpStatus: res.status,
      raw: body,
    };
  } catch (e) {
    steps["step5_me_permissions"] = { error: String(e) };
  }

  // ── Step 6: Business-asset traversal ──
  try {
    const url = new URL(`${graphBase}/me/businesses`);
    url.searchParams.set("fields", "id,name");
    url.searchParams.set("access_token", accessToken);

    const res = await fetch(url.toString());
    const body = await res.json();

    steps["step6_me_businesses"] = {
      httpStatus: res.status,
      raw: body,
    };

    // If businesses found, probe each for instagram_business_accounts
    if (res.ok && Array.isArray((body as { data?: unknown[] }).data)) {
      const businesses = (body as { data: Array<{ id: string }> }).data;
      const igResults: Record<string, unknown> = {};

      for (const biz of businesses) {
        if (!biz.id) continue;
        try {
          const igUrl = new URL(`${graphBase}/${biz.id}/instagram_business_accounts`);
          igUrl.searchParams.set("fields", "id,username");
          igUrl.searchParams.set("access_token", accessToken);

          const igRes = await fetch(igUrl.toString());
          const igBody = await igRes.json();

          igResults[biz.id] = {
            httpStatus: igRes.status,
            raw: igBody,
          };
        } catch (e) {
          igResults[biz.id] = { error: String(e) };
        }
      }

      steps["step6_business_ig_accounts"] = igResults;
    }
  } catch (e) {
    steps["step6_me_businesses"] = { error: String(e) };
  }

  // ── Build conclusion ──
  const meAccounts = (steps["step1_me_accounts"] as { raw?: { data?: Array<{ id: string; name: string; instagram_business_account?: unknown }> } })?.raw;
  const pageProbe = (steps["step3_page_node_probe"] as { raw?: { instagram_business_account?: unknown } })?.raw;
  const permissions = (steps["step5_me_permissions"] as { raw?: { data?: Array<{ permission: string; status: string }> } })?.raw;

  const hasIgInMeAccounts = meAccounts?.data?.some(
    (p) => p.instagram_business_account !== null && p.instagram_business_account !== undefined,
  ) ?? false;

  const hasIgOnPage = pageProbe?.instagram_business_account !== null &&
    pageProbe?.instagram_business_account !== undefined;

  const grantedPermissions = permissions?.data
    ?.filter((p) => p.status === "granted")
    .map((p) => p.permission) ?? [];

  const hasInstagramBasic = grantedPermissions.includes("instagram_basic");
  const hasPagesShowList = grantedPermissions.includes("pages_show_list");
  const hasPagesReadEngagement = grantedPermissions.includes("pages_read_engagement");
  const hasBusinessManagement = grantedPermissions.includes("business_management");

  let conclusion: string;

  if (hasIgInMeAccounts || hasIgOnPage) {
    conclusion = "IG_BUSINESS_ACCOUNT_PRESENT: instagram_business_account IS visible in raw API. Bug is likely in discoverPage()/discoverInstagram() code not correctly reading it. Review the code paths.";
  } else if (!hasInstagramBasic) {
    conclusion = "MISSING_PERMISSION: instagram_basic is NOT granted. This is the most likely cause — Meta silently omits the instagram_business_account field when the token lacks this permission.";
  } else if (!hasPagesShowList) {
    conclusion = "MISSING_PERMISSION: pages_show_list is NOT granted. Required for /me/accounts to return Pages.";
  } else {
    conclusion = "META_SIDE_ISSUE: instagram_business_account is missing from raw API despite correct permissions. This is a known Meta-side data issue — the Page-to-Instagram link may not be visible via Graph API despite showing in Meta UI. User may need to re-link from Instagram app settings rather than Page settings.";
  }

  const result: DiagResult = {
    businessId: business.id,
    facebookAccountId: storedPageId,
    facebookAccountLabel: (fbRow as { account_label: string }).account_label,
    steps,
    conclusion,
  };

  return NextResponse.json(result, { status: 200 });
}
