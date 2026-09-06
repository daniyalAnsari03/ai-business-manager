/**
 * Focused regression test for the production Instagram OAuth reconnect fix.
 *
 * Root cause: the callback discovered a Facebook Page and then probed
 * GET /{page-id}?fields=id,instagram_business_account{id,username} with the
 * USER access token. Meta answers that request with HTTP 200 but omits the
 * `instagram_business_account` edge for EVERY Page unless the request is
 * authenticated with the PAGE's OWN access token (the Page-scoped token that
 * /me/accounts returns next to each Page). Production therefore saw
 * `ig_present=false` for all 3 Pages and reached `no_linked_ig`, rejecting a
 * reconnect even though the Pages and their Instagram Business accounts ARE
 * linked (connected via Meta's /pages/link-accounts).
 *
 * These tests prove:
 *   A. the /me/accounts Page access token is retained per Page
 *   B. the Page-node Instagram lookup is performed with THAT Page's access
 *      token (a regression to the user token makes the mock fail the test)
 *   C. a Page with an `instagram_business_account.id` is selected even when the
 *      username is absent (the username is then resolved separately)
 *   D. a Page without a linked Instagram Business account is rejected
 *   E. the FIRST Page that has a linked Instagram Business account is selected
 *
 * Run: node --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/marketing/meta-oauth-discover.test.mjs
 */

process.env.META_APP_ID = process.env.META_APP_ID || "test-app-id";
process.env.META_APP_SECRET = process.env.META_APP_SECRET || "test-app-secret";

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const { discoverPage } = await import("../../lib/marketing/meta-oauth.ts");

const REAL_FETCH = globalThis.fetch;
const USER_TOKEN = "user-access-token";
const IG_ID = "17841400000000001";

/**
 * Installs a fetch mock over the Graph API. Each handler:
 *   - `matches`   — substring that identifies its URL (probe paths like "/111")
 *   - `expectedToken` — when set, the request MUST carry
 *                       `access_token=<exact page access token>`. A mismatch
 *                       throws, so any regression to the user token fails the
 *                       surrounding case loudly and explains itself.
 * Handlers are consumed once in insertion order.
 */
function withMeta(calls) {
  const seen = [];
  const tokenChecks = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    const handler = calls.find(
      (call) => url.includes(call.matches) && !call.consumed,
    );
    if (!handler) {
      throw new Error(`Unexpected Graph API call: ${url}`);
    }
    handler.consumed = true;
    if (handler.expectedToken) {
      const used = url.includes(`access_token=${handler.expectedToken}`);
      tokenChecks.push({
        url,
        expected: handler.expectedToken,
        used,
        pageId: handler.pageId,
      });
      if (!used) {
        throw new Error(
          `Page-node lookup for page ${handler.pageId} used the WRONG access token. expected=${handler.expectedToken} actual_url=${url}`,
        );
      }
    }
    return {
      ok: handler.status < 400,
      status: handler.status,
      json: async () => structuredClone(handler.payload),
    };
  };
  return { seen, tokenChecks };
}

async function resetFetch() {
  globalThis.fetch = REAL_FETCH;
}

// Root-cause case: /me/accounts omits the nested edge for EVERY page (the
// documented Meta gotcha + the exact production shape), each Page carries its
// OWN Page access token, and each Page lacking the nested edge is probed with
// ITS OWN token. Proves A, B and E in one flow.
{
  const { seen, tokenChecks } = withMeta([
    {
      matches: "/me/accounts",
      status: 200,
      payload: {
        data: [
          { id: "111", name: "D&N Collection", access_token: "page-token-111" },
          { id: "222", name: "mr_dani__03", access_token: "page-token-222" },
        ],
      },
    },
    {
      matches: "/111",
      pageId: "111",
      expectedToken: "page-token-111",
      status: 200,
      payload: { id: "111", instagram_business_account: null },
    },
    {
      matches: "/222",
      pageId: "222",
      expectedToken: "page-token-222",
      status: 200,
      payload: {
        id: "222",
        instagram_business_account: { id: IG_ID, username: "dinsbydaniyal" },
      },
    },
  ]);
  const result = await discoverPage(USER_TOKEN, { requireInstagram: true });
  const passed =
    result.ok &&
    result.page.id === "222" &&
    result.page.instagram?.id === IG_ID &&
    result.page.instagram?.username === "dinsbydaniyal";

  record(
    "A — each /me/accounts Page access token is retained and used for THAT Page's probe",
    tokenChecks.length === 2 && tokenChecks.every((t) => t.used),
    tokenChecks.map((t) => `${t.pageId}=${t.used ? "ok" : "WRONG"}`).join(", "),
  );
  record(
    "B — Page-node IG lookup uses the Page access token, never the user token",
    seen
      .filter((u) => !u.includes("/me/accounts"))
      .every((u) => !u.includes(`access_token=${USER_TOKEN}`)),
    seen.join(" | "),
  );
  record(
    "E — first Page with a linked IG account is selected when Meta omits every nested edge",
    passed,
  );
  const probes = seen.filter((u) => !u.includes("/me/accounts"));
  record(
    "exactly the Pages lacking the nested edge are probed once",
    probes.length === 2,
    seen.join(" | "),
  );
  await resetFetch();
}

// Probe discovers a linked IG account that /me/accounts omitted, and the
// probe carries the page's own token.
{
  const { seen } = withMeta([
    {
      matches: "/me/accounts",
      status: 200,
      payload: {
        data: [
          { id: "222", name: "DINS by Daniyal", access_token: "page-token-222" },
        ],
      },
    },
    {
      matches: "/222",
      pageId: "222",
      expectedToken: "page-token-222",
      status: 200,
      payload: {
        id: "222",
        instagram_business_account: { id: IG_ID, username: "dinsbydaniyal" },
      },
    },
  ]);
  const result = await discoverPage(USER_TOKEN, { requireInstagram: true });
  record(
    "discovers linked IG via Page-node probe (with page token) when /me/accounts omits the edge",
    result.ok &&
      result.page.id === "222" &&
      result.page.instagram?.id === IG_ID &&
      result.page.instagram?.username === "dinsbydaniyal",
  );
  const probes = seen.filter((u) => !u.includes("/me/accounts"));
  record(
    "exactly one probe for the Page lacking the nested edge",
    probes.length === 1,
    seen.join(" | "),
  );
  await resetFetch();
}

// C — detection keys on the id: the probe returns an Instagram account with
// NO username; selection must still succeed and the username resolved from the
// IG account node exactly once.
{
  const { seen } = withMeta([
    {
      matches: "/me/accounts",
      status: 200,
      payload: {
        data: [{ id: "222", name: "DINS by Daniyal", access_token: "page-token-222" }],
      },
    },
    {
      matches: "/222",
      pageId: "222",
      expectedToken: "page-token-222",
      status: 200,
      payload: {
        id: "222",
        instagram_business_account: { id: IG_ID },
      },
    },
    {
      matches: `/${IG_ID}`,
      status: 200,
      payload: { id: IG_ID, username: "dinsbydaniyal" },
    },
  ]);
  const result = await discoverPage(USER_TOKEN, { requireInstagram: true });
  record(
    "C — an IG account is kept even when the probe/edge omits username (keyed on id), then resolved",
    result.ok &&
      result.page.instagram?.id === IG_ID &&
      result.page.instagram?.username === "dinsbydaniyal",
  );
  const probes = seen.filter((u) => !u.includes("/me/accounts"));
  record(
    "probe + username resolution made exactly two extra calls",
    probes.length === 2,
    seen.join(" | "),
  );
  await resetFetch();
}

// C — nested edge on /me/accounts carries id but no username: selected
// directly by id, username resolved from the IG node.
{
  const { seen } = withMeta([
    {
      matches: "/me/accounts",
      status: 200,
      payload: {
        data: [
          {
            id: "222",
            name: "DINS by Daniyal",
            access_token: "page-token-222",
            instagram_business_account: { id: IG_ID },
          },
        ],
      },
    },
    {
      matches: `/${IG_ID}`,
      status: 200,
      payload: { id: IG_ID, username: "dinsbydaniyal" },
    },
  ]);
  const result = await discoverPage(USER_TOKEN, { requireInstagram: true });
  record(
    "selects a nested linked IG account when username is absent (then resolves it)",
    result.ok &&
      result.page.instagram?.id === IG_ID &&
      result.page.instagram?.username === "dinsbydaniyal",
  );
  const probes = seen.filter((u) => !u.includes("/me/accounts"));
  record(
    "username resolution made exactly one extra IG-node call",
    probes.length === 1,
    seen.join(" | "),
  );
  await resetFetch();
}

// D — NO Page has a linked Instagram account: every candidate is probed with
// its own Page access token and the connect is honestly rejected.
{
  const { tokenChecks } = withMeta([
    {
      matches: "/me/accounts",
      status: 200,
      payload: {
        data: [
          { id: "111", name: "Personal Page", access_token: "page-token-111" },
          { id: "222", name: "Other Page", access_token: "page-token-222" },
        ],
      },
    },
    {
      matches: "/111",
      pageId: "111",
      expectedToken: "page-token-111",
      status: 200,
      payload: { id: "111", instagram_business_account: null },
    },
    {
      matches: "/222",
      pageId: "222",
      expectedToken: "page-token-222",
      status: 200,
      payload: { id: "222", instagram_business_account: null },
    },
  ]);
  const result = await discoverPage(USER_TOKEN, { requireInstagram: true });
  record(
    "D — rejects when no Page has a linked Instagram Business account",
    !result.ok && result.message.includes("Instagram Business account"),
    !result.ok ? "" : "unexpected ok",
  );
  record(
    "both candidate probes used their own Page access token",
    tokenChecks.length === 2 && tokenChecks.every((t) => t.used),
  );
  await resetFetch();
}

// E — multiple Pages, the FIRST has a nested linked IG account: it is selected
// without probing later Pages.
{
  const { seen } = withMeta([
    {
      matches: "/me/accounts",
      status: 200,
      payload: {
        data: [
          {
            id: "111",
            name: "DINS by Daniyal",
            access_token: "page-token-111",
            instagram_business_account: {
              id: IG_ID,
              username: "dinsbydaniyal",
            },
          },
          { id: "222", name: "mr_dani__03", access_token: "page-token-222" },
        ],
      },
    },
  ]);
  const result = await discoverPage(USER_TOKEN, { requireInstagram: true });
  record(
    "E — first Page with a linked IG account is selected (no probe needed)",
    result.ok &&
      result.page.id === "111" &&
      result.page.instagram?.username === "dinsbydaniyal" &&
      result.page.instagram?.id === IG_ID,
  );
  record("no Page-node probe is issued when the first Page already has IG", seen.length === 1, seen.join(" | "));
  await resetFetch();
}

// Plain Facebook connect accepts the first Page and reports IG linkage.
{
  withMeta([
    {
      matches: "/me/accounts",
      status: 200,
      payload: {
        data: [
          {
            id: "111",
            name: "Personal Page",
            access_token: "page-token-111",
            instagram_business_account: { id: IG_ID, username: "some.ig" },
          },
          { id: "222", name: "DINS by Daniyal", access_token: "page-token-222" },
        ],
      },
    },
  ]);
  const result = await discoverPage(USER_TOKEN);
  record(
    "plain facebook connect keeps first-Page behaviour and reports IG",
    result.ok &&
      result.page.id === "111" &&
      result.page.instagram?.username === "some.ig",
  );
  await resetFetch();
}

const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);