/**
 * Focused regression test for the production Instagram OAuth fix.
 *
 * Reproduces the exact root cause of the `@dinsbydaniyal` connection failure:
 * the callback must choose the FIRST managed Facebook Page that actually has a
 * linked Instagram Business account (never the first Page in the list), and
 * must NOT reject a linked account merely because Meta omitted `username` from
 * the /me/accounts edge. It also covers the core bug: Meta does not reliably
 * return the nested `instagram_business_account` edge from /me/accounts, so a
 * Page whose IG account is absent there is probed directly on its Page node
 * (GET /{page-id}?fields=instagram_business_account{id,username}) before the
 * connection is rejected.
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

function withMetaResponses(calls) {
  const seen = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    const handler = calls.find(
      (call) => url.includes(call.matches) && !call.consumed,
    );
    if (handler) {
      handler.consumed = true;
      return {
        ok: handler.status < 400,
        status: handler.status,
        json: async () => structuredClone(handler.payload),
      };
    }
    throw new Error(`Unexpected Graph API call: ${url}`);
  };
  return seen;
}

async function resetFetch() {
  globalThis.fetch = REAL_FETCH;
}

// Case 1: multiple Pages, the FIRST has no linked IG, the SECOND has the
// nested edge for a page linked to @dinsbydaniyal — requireInstagram must
// probe the first Page (no IG) and pick the second.
{
  const seen = withMetaResponses([
    {
      matches: "/me/accounts",
      status: 200,
      payload: {
        data: [
          { id: "111", name: "Personal Page" },
          {
            id: "222",
            name: "DINS by Daniyal",
            instagram_business_account: {
              id: "17841400000000001",
              username: "dinsbydaniyal",
            },
          },
        ],
      },
    },
    {
      matches: "/111",
      status: 200,
      payload: { id: "111", instagram_business_account: null },
    },
  ]);
  const result = await discoverPage("tok", { requireInstagram: true });
  const passed =
    result.ok &&
    result.page.id === "222" &&
    result.page.instagram?.id === "17841400000000001" &&
    result.page.instagram?.username === "dinsbydaniyal";
  record("picks first Page with linked IG (not the first Page)", passed);
  record(
    "no username resolution needed when Meta returns it",
    seen.length === 2 && !seen.some((u) => u.includes("17841400000000001")),
    seen.join(" | "),
  );
  await resetFetch();
}

// Case 1b: THE production bug — /me/accounts returns the linked Page but
// OMITS the nested `instagram_business_account` edge entirely (a documented
// Meta gotcha). The Page node probe must discover the linked IG account and
// select the Page, instead of the old false "No Instagram Business account is
// linked to any of your Facebook Pages." error.
{
  const seen = withMetaResponses([
    {
      matches: "/me/accounts",
      status: 200,
      payload: {
        data: [
          { id: "111", name: "Personal Page" },
          { id: "222", name: "DINS by Daniyal" },
        ],
      },
    },
    {
      matches: "/111",
      status: 200,
      payload: { id: "111", instagram_business_account: null },
    },
    {
      matches: "/222",
      status: 200,
      payload: {
        id: "222",
        instagram_business_account: {
          id: "17841400000000001",
          username: "dinsbydaniyal",
        },
      },
    },
  ]);
  const result = await discoverPage("tok", { requireInstagram: true });
  const passed =
    result.ok &&
    result.page.id === "222" &&
    result.page.instagram?.id === "17841400000000001" &&
    result.page.instagram?.username === "dinsbydaniyal";
  record(
    "discovers linked IG via Page-node probe when /me/accounts omits the edge",
    passed,
  );
  record(
    "exactly one probe per Page lacking the nested edge",
    seen.length === 3,
    seen.join(" | "),
  );
  await resetFetch();
}

// Case 1c: same as 1b but the Page-node probe omits `username` — selection
// must still succeed (keyed on id) and the username resolved separately.
{
  const seen = withMetaResponses([
    {
      matches: "/me/accounts",
      status: 200,
      payload: {
        data: [{ id: "222", name: "DINS by Daniyal" }],
      },
    },
    {
      matches: "/222",
      status: 200,
      payload: {
        id: "222",
        instagram_business_account: { id: "17841400000000001" },
      },
    },
    {
      matches: "/17841400000000001",
      status: 200,
      payload: { id: "17841400000000001", username: "dinsbydaniyal" },
    },
  ]);
  const result = await discoverPage("tok", { requireInstagram: true });
  const passed =
    result.ok &&
    result.page.instagram?.id === "17841400000000001" &&
    result.page.instagram?.username === "dinsbydaniyal";
  record(
    "probe-found IG account is kept even when its username is absent (then resolved)",
    passed,
  );
  record("probe + username resolution made exactly two extra calls", seen.length === 3);
  await resetFetch();
}

// Case 2: the linked IG Page is present but Meta omits `username` on the
// /me/accounts edge — the account must still be selected (keyed on id) and
// the username resolved from the IG node.
{
  const seen = withMetaResponses([
    {
      matches: "/me/accounts",
      status: 200,
      payload: {
        data: [
          {
            id: "222",
            name: "DINS by Daniyal",
            instagram_business_account: { id: "17841400000000001" },
          },
        ],
      },
    },
    {
      matches: "/17841400000000001",
      status: 200,
      payload: { id: "17841400000000001", username: "dinsbydaniyal" },
    },
  ]);
  const result = await discoverPage("tok", { requireInstagram: true });
  const passed =
    result.ok &&
    result.page.instagram?.id === "17841400000000001" &&
    result.page.instagram?.username === "dinsbydaniyal";
  record(
    "selects a linked IG account even when username is absent (then resolves it)",
    passed,
  );
  record("username resolution made exactly one IG-node call", seen.length === 2);
  await resetFetch();
}

// Case 3: NO Page has a linked Instagram Business account — honest failure
// after probing every Page that lacks the nested edge.
{
  withMetaResponses([
    {
      matches: "/me/accounts",
      status: 200,
      payload: {
        data: [
          { id: "111", name: "Personal Page" },
          { id: "222", name: "Other Page" },
        ],
      },
    },
    {
      matches: "/111",
      status: 200,
      payload: { id: "111", instagram_business_account: null },
    },
    {
      matches: "/222",
      status: 200,
      payload: { id: "222", instagram_business_account: null },
    },
  ]);
  const result = await discoverPage("tok", { requireInstagram: true });
  record(
    "rejects when no Page has a linked Instagram Business account",
    !result.ok && result.message.includes("Instagram Business account"),
    !result.ok ? "" : "unexpected ok",
  );
  await resetFetch();
}

// Case 4: plain Facebook connect accepts the first Page and reports IG linkage.
{
  withMetaResponses([
    {
      matches: "/me/accounts",
      status: 200,
      payload: {
        data: [
          {
            id: "111",
            name: "Personal Page",
            instagram_business_account: {
              id: "17841400000000009",
              username: "some.ig",
            },
          },
          { id: "222", name: "DINS by Daniyal" },
        ],
      },
    },
  ]);
  const result = await discoverPage("tok");
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