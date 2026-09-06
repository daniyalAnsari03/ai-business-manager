/**
 * Focused regression test for the production Instagram OAuth reconnect fix.
 *
 * Production evidence (deployment of commit d653cf3,
 * ai-business-manager-three.vercel.app, 2026-09-05):
 *   [FB-OAuth-Page] data_count: 3
 *   [FB-OAuth-Diag] /me/accounts page id=118212491230491 name="D&N Collection" nested_ig=none
 *   [FB-OAuth-Diag] /me/accounts page id=106463831211396 name="mr_dani__03" nested_ig=none
 *   [FB-OAuth-Diag] /me/accounts page id=657333931393316 name="Hafiz daniyal ansari" nested_ig=none
 *   [FB-OAuth-Diag] candidate skipped ... reason=no_page_access_token
 *   [FB-OAuth-Diag] candidate rejected ... probe_attempted=no probe_http=n/a   (x3)
 *   [FB-OAuth-Page] Rejected: no Page has a linked Instagram Business account.
 *
 * ROOT CAUSE: discoverPage() called GET /me/accounts with
 * `fields=id,name,instagram_business_account{id,username}` and NEVER requested
 * the `access_token` field. Meta only returns a Page's access token when that
 * field is explicitly requested, so every `page.access_token` was undefined at
 * runtime and the Page-node probe was never attempted (`probe_attempted=no`).
 * That is why the "use the Page access token" change in d653cf3 changed
 * NOTHING in production. The previous /me/accounts nested edge AND the older
 * user-token probes also used the `instagram_business_account{id,username}`
 * expansion, which Meta silently drops entirely (HTTP 200, no error) when the
 * expanded subfields cannot be resolved for the token/account.
 *
 * The Meta mock below emulates the REAL Graph API field behaviour: a Page is
 * only returned with `access_token` (and with `instagram_business_account`)
 * when those fields were actually requested, and the nested
 * `instagram_business_account{id,username}` expansion yields no edge. Any
 * regression that forgets `access_token` therefore reproduces the production
 * `no_page_access_token` failure and fails the tests.
 *
 * These tests prove:
 *   A. /me/accounts requests `access_token` (the exact d653cf3 omission) and
 *      each returned Page access token is used for THAT Page's probe
 *   B. the Page-node IG probe uses the Page access token, never the user token
 *   C. a linked IG account is detected from the real Meta response shapes, the
 *      `{id,username}` expansion is never requested, and a username-less IG id
 *      is still selected (username resolved separately)
 *   D. a Page with an `instagram_business_account.id` is selected even when no
 *      username came back
 *   E. the FIRST Page that has a linked Instagram Business account is selected
 *   F. when the Page token probe returns no IG, the documented user-token
 *      fallback is attempted
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
 * Emulates Meta's /me/accounts handler: it returns, for every requested Page,
 * ONLY the fields that were actually requested. Crucially, `access_token` is
 * returned ONLY when the `fields` parameter names it — exactly like the real
 * API. Page-need `ig` entries model the linked Instagram Business account.
 * Requesting the old `instagram_business_account{id,username}` expansion
 * yields no edge (the real production gotcha).
 */
function mockMeAccounts(pages) {
  return (url) => {
    const fields = new URL(url).searchParams.get("fields") ?? "";
    // The Graph API `fields` parameter is comma separated, but field expansion
    // puts braces around its own comma (instagram_business_account{id,username}),
    // so detect a request against the RAW parameter, not the split parts.
    const requested = (f) =>
      fields
        .split(",")
        .some((part) => part.trim() === f || part.trim().startsWith(`${f}{`));
    const wantsExpansion = fields.includes("{id,username}");
    const data = pages
      .map((p) => {
        const out = {};
        if (requested("id")) out.id = p.id;
        if (requested("name")) out.name = p.name;
        if (requested("access_token")) out.access_token = p.accessToken;
        if (requested("instagram_business_account") && p.ig) {
          // The expanded form is what always came back empty in production.
          if (!wantsExpansion) {
            out.instagram_business_account = p.ig.username
              ? { id: p.ig.id, username: p.ig.username }
              : { id: p.ig.id };
          }
        }
        return out;
      })
      .filter((p) => p.id);
    return { ok: true, status: 200, payload: { data } };
  };
}

/**
 * Installs a fetch mock over the Graph API. Matches handlers by URL substring
 * AND, when a handler specifies `expectedToken`, by the exact access_token it
 * must carry. Handlers are consumed once in insertion order.
 */
function withMeta(calls) {
  const seen = [];
  const tokenChecks = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    const handler = calls.find(
      (call) => {
        if (call.consumed) return false;
        if (!url.includes(call.matches)) return false;
        if (call.expectedToken) {
          return url.includes(`access_token=${call.expectedToken}`);
        }
        return true;
      },
    );
    if (!handler) {
      throw new Error(`Unexpected Graph API call: ${url}\nSeen so far:\n${seen.join("\n")}`);
    }
    handler.consumed = true;
    if (handler.expectedToken) {
      tokenChecks.push({ url, pageId: handler.pageId });
    }
    const respond = handler.custom ? handler.custom(url) : handler;
    return {
      ok: respond.status < 400,
      status: respond.status,
      json: async () => structuredClone(respond.payload),
    };
  };
  return { seen, tokenChecks };
}

async function resetFetch() {
  globalThis.fetch = REAL_FETCH;
}

// REGRESSION (the d653cf3 bug): /me/accounts returns Page access tokens ONLY
// because the request actually asked for `access_token`. Under the previous
// implementation the fields parameter omitted it, so this mock would have
// returned pages without tokens, every candidate hit `no_page_access_token`,
// no probe ran, and the whole flow failed with the exact production error.
{
  const { seen, tokenChecks } = withMeta([
    {
      matches: "/me/accounts",
      custom: mockMeAccounts([
        { id: "111", name: "D&N Collection", accessToken: "page-token-111", ig: null },
        {
          id: "222",
          name: "mr_dani__03",
          accessToken: "page-token-222",
          ig: { id: IG_ID, username: "dinsbydaniyal" },
        },
      ]),
    },
    {
      matches: "/111",
      pageId: "111",
      expectedToken: "page-token-111",
      status: 200,
      payload: { id: "111", instagram_business_account: null },
    },
  ]);
  const result = await discoverPage(USER_TOKEN, { requireInstagram: true });
  record(
    "REGRESSION(d653cf3) — linked IG found when /me/accounts is asked for access_token and the probe uses it",
    result.ok &&
      result.page.id === "222" &&
      result.page.instagram?.id === IG_ID &&
      result.page.instagram?.username === "dinsbydaniyal",
  );
  record(
    "REGRESSION(d653cf3) — /me/accounts fields include access_token",
    seen.some((u) => u.includes("/me/accounts") && u.includes("fields=") && u.includes("access_token")),
    seen[0] ?? "no calls",
  );
  record(
    "REGRESSION(d653cf3) — every candidate probe used its own Page access token",
    tokenChecks.length === 1 && tokenChecks[0].pageId === "111",
    tokenChecks.map((t) => `${t.pageId} ok`).join(", "),
  );
  record(
    "no {id,username} expansion is requested anywhere",
    seen.every((u) => !u.includes("{id,username}")),
    seen.join(" | "),
  );
  await resetFetch();
}

// Root-cause case: the documented /me/accounts field set returns each Page with
// its OWN access token but NO nested edge for any Page (the exact production
// shape), and each Page lacking a linked IG is probed with its own token until
// the one carrying the linked IG account is found.
{
  const { seen, tokenChecks } = withMeta([
    {
      matches: "/me/accounts",
      custom: mockMeAccounts([
        { id: "111", name: "D&N Collection", accessToken: "page-token-111", ig: null },
        { id: "222", name: "mr_dani__03", accessToken: "page-token-222", ig: null },
      ]),
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
      payload: { id: "222", instagram_business_account: { id: IG_ID } },
    },
    {
      matches: `/${IG_ID}`,
      status: 200,
      payload: { id: IG_ID, username: "dinsbydaniyal" },
    },
  ]);
  const result = await discoverPage(USER_TOKEN, { requireInstagram: true });
  record(
    "A — linked IG detected via the Page-node probe when /me/accounts omits every edge",
    result.ok &&
      result.page.id === "222" &&
      result.page.instagram?.id === IG_ID &&
      result.page.instagram?.username === "dinsbydaniyal",
  );
  record(
    "B — the linked Page was found via its OWN Page access token (first probe try)",
    tokenChecks.filter((t) => t.url.includes("access_token=page-token-222")).length === 1,
    seen.join(" | "),
  );
  await resetFetch();
}

// C — detection keys on the id: the probe returns the IG account with NO
// username; selection must still succeed and the username is resolved from the
// IG account node exactly once (with the user token).
{
  const { seen } = withMeta([
    {
      matches: "/me/accounts",
      custom: mockMeAccounts([
        {
          id: "222",
          name: "DINS by Daniyal",
          accessToken: "page-token-222",
          ig: null,
        },
      ]),
    },
    {
      matches: "/222",
      pageId: "222",
      expectedToken: "page-token-222",
      status: 200,
      payload: { id: "222", instagram_business_account: { id: IG_ID } },
    },
    {
      matches: `/${IG_ID}`,
      status: 200,
      payload: { id: IG_ID, username: "dinsbydaniyal" },
    },
  ]);
  const result = await discoverPage(USER_TOKEN, { requireInstagram: true });
  record(
    "C — an IG account is kept even when the probe omits username (keyed on id), then resolved",
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

// D — a plain `instagram_business_account` on /me/accounts (documented shape,
// no nested expansion) with id but no username: selected directly, username
// resolved from the IG User node.
{
  const { seen } = withMeta([
    {
      matches: "/me/accounts",
      custom: mockMeAccounts([
        {
          id: "222",
          name: "DINS by Daniyal",
          accessToken: "page-token-222",
          ig: { id: IG_ID, username: undefined },
        },
      ]),
    },
    {
      matches: `/${IG_ID}`,
      status: 200,
      payload: { id: IG_ID, username: "dinsbydaniyal" },
    },
  ]);
  const result = await discoverPage(USER_TOKEN, { requireInstagram: true });
  record(
    "D — selects a plain linked IG id (no username) from /me/accounts, then resolves it",
    result.ok &&
      result.page.instagram?.id === IG_ID &&
      result.page.instagram?.username === "dinsbydaniyal",
  );
  record(
    "username resolution made exactly one extra IG-node call",
    seen.length === 2,
    seen.join(" | "),
  );
  await resetFetch();
}

// F — when the Page-token probe returns no IG, the user-token fallback is
// attempted and can discover a linked IG account (the Meta "Get Started" flow
// documents the user token for this exact Page-node request).
{
  const { seen, tokenChecks } = withMeta([
    {
      matches: "/me/accounts",
      custom: mockMeAccounts([
        {
          id: "222",
          name: "DINS by Daniyal",
          accessToken: "page-token-222",
          ig: null,
        },
      ]),
    },
    {
      matches: "/222",
      pageId: "222",
      expectedToken: "page-token-222",
      status: 200,
      payload: { id: "222", instagram_business_account: null },
    },
    {
      matches: "/222",
      pageId: "222",
      expectedToken: USER_TOKEN,
      status: 200,
      payload: { id: "222", instagram_business_account: { id: IG_ID } },
    },
  ]);
  const result = await discoverPage(USER_TOKEN, { requireInstagram: true });
  record(
    "F — user-token fallback discovers the linked IG when the Page token yields nothing",
    result.ok &&
      result.page.id === "222" &&
      result.page.instagram?.id === IG_ID,
  );
  record(
    "fallback probes used page token first, then user token",
    tokenChecks.length === 2 &&
      tokenChecks[0].url.includes(`access_token=page-token-222`) &&
      tokenChecks[1].url.includes(`access_token=${USER_TOKEN}`),
    seen.join(" | "),
  );
  await resetFetch();
}

// D — NO Page has a linked Instagram account: every candidate is probed (page
// token, then user token) and the connect is honestly rejected.
{
  withMeta([
    {
      matches: "/me/accounts",
      custom: mockMeAccounts([
        { id: "111", name: "Personal Page", accessToken: "page-token-111", ig: null },
        { id: "222", name: "Other Page", accessToken: "page-token-222", ig: null },
      ]),
    },
    {
      matches: "/111",
      pageId: "111",
      expectedToken: "page-token-111",
      status: 200,
      payload: { id: "111", instagram_business_account: null },
    },
    {
      matches: "/111",
      pageId: "111",
      expectedToken: USER_TOKEN,
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
    {
      matches: "/222",
      pageId: "222",
      expectedToken: USER_TOKEN,
      status: 200,
      payload: { id: "222", instagram_business_account: null },
    },
  ]);
  const result = await discoverPage(USER_TOKEN, { requireInstagram: true });
  record(
    "no linked IG anywhere — the connect is honestly rejected",
    !result.ok && result.message.includes("Instagram Business account"),
    !result.ok ? "" : "unexpected ok",
  );
  await resetFetch();
}

// E — multiple Pages, the FIRST has a linked IG account on /me/accounts: it is
// selected without probing later Pages.
{
  const { seen } = withMeta([
    {
      matches: "/me/accounts",
      custom: mockMeAccounts([
        {
          id: "111",
          name: "DINS by Daniyal",
          accessToken: "page-token-111",
          ig: { id: IG_ID, username: "dinsbydaniyal" },
        },
        { id: "222", name: "mr_dani__03", accessToken: "page-token-222", ig: null },
      ]),
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
      custom: mockMeAccounts([
        {
          id: "111",
          name: "Personal Page",
          accessToken: "page-token-111",
          ig: { id: IG_ID, username: "some.ig" },
        },
        { id: "222", name: "DINS by Daniyal", accessToken: "page-token-222", ig: null },
      ]),
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