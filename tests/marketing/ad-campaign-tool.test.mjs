/**
 * Offline test of the create_ad_campaign controlled tool (docs/phase0.txt §4).
 *
 * Verifies the HONEST not-connected fallback and the connected-stub branch
 * WITHOUT any Supabase, secrets or business data — the service layer is
 * stubbed via a dedicated module hook, so only the tool's own decision logic
 * is exercised. This proves the tool:
 *   - never creates a fake/pending campaign when Meta Ads is not connected;
 *   - returns a clear, localized "connect karein" style message for that case;
 *   - only reaches the stub (not_implemented) branch once connected.
 *
 * Run: node --conditions=react-server --import ./tests/marketing/register-ad-campaign-hooks.mjs tests/marketing/ad-campaign-tool.test.mjs
 */

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const { serviceState } = await import("./ad-campaign-stubs/service-state.mjs");
const { createAdCampaignTool } = await import("../../lib/ai/tools/ad-campaign-tools.ts");

function getProduct() {
  return {
    id: "prod-1",
    name: "Black Kurta",
    category: "Kurta",
    price: 1500,
  };
}

// invoke(runContext, jsonInputString) is the SDK's call signature for a tool.
const call = (args) => createAdCampaignTool.invoke(undefined, JSON.stringify(args));

/* ---------------------------------------------------------------------------
 * Case 1: Meta Ads NOT connected -> honest fallback, no fake campaign.
 * ------------------------------------------------------------------------ */
serviceState.products = { ok: true, data: [getProduct()] };
serviceState.metaAdsConnection = {
  ok: true,
  data: { connected: false, account: null },
};

const parsedNotConnected = JSON.parse(await call({ productName: "Black Kurta" }));

record(
  "Tool: Meta Ads not connected -> status is the honest error (not 'ok')",
  parsedNotConnected.status === "error" && parsedNotConnected.reason === "meta_ads_not_connected",
  JSON.stringify(parsedNotConnected),
);

record(
  "Tool: not-connected message tells the user to connect in Settings (localized hint)",
  /connect karein/i.test(parsedNotConnected.hint ?? "") &&
    /no ad was created/i.test(parsedNotConnected.hint ?? ""),
  JSON.stringify(parsedNotConnected.hint ?? ""),
);

/* ---------------------------------------------------------------------------
 * Case 2: product not found -> never fabricates an ad for an unknown item.
 * ------------------------------------------------------------------------ */
serviceState.products = { ok: true, data: [getProduct()] };
serviceState.metaAdsConnection = {
  ok: true,
  data: { connected: false, account: null },
};
const notFound = JSON.parse(await call({ productName: "Silk Saree" }));
record(
  "Tool: unknown product -> not_found, no campaign created",
  notFound.status === "error" && notFound.reason === "not_found",
);

/* ---------------------------------------------------------------------------
 * Case 3: Meta Ads CONNECTED -> stub branch (no real API in this phase),
 * still honest that nothing was launched.
 * ------------------------------------------------------------------------ */
serviceState.products = { ok: true, data: [getProduct()] };
serviceState.metaAdsConnection = {
  ok: true,
  data: {
    connected: true,
    account: { adAccountName: "My Ad Account" },
  },
};
const connected = JSON.parse(await call({ productName: "Black Kurta" }));
record(
  "Tool: Meta Ads connected -> reaches the stub branch, not_implemented (no fake launch)",
  connected.status === "not_implemented" &&
    connected.connected === true &&
    connected.ad_account_name === "My Ad Account",
  JSON.stringify(connected),
);

/* ---------------------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------------------ */
const failed = results.filter((r) => !r.passed);
console.log("\n===== SUMMARY =====");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
