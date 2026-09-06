/**
 * Focused regression test for the production Instagram OAuth fix.
 *
 * Reproduces the exact root cause of the `@dinsbydaniyal` connection failure:
 * the callback must choose the FIRST managed Facebook Page that actually has a
 * linked Instagram Business account (never the first Page in the list), and
 * must NOT reject a linked account merely because Meta omitted `username` from
 * the /me/accounts edge.
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

// Case 1: multiple Pages, the FIRST has no linked IG, the SECOND is the DINS
// page linked to @dinsbydaniyal — requireInstagram must pick the second.
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
  ]);
  const result = await discoverPage("tok", { requireInstagram: true });
  const passed =
    result.ok &&
    result.page.id === "222" &&
    result.page.instagram?.id === "17841400000000001" &&
    result.page.instagram?.username === "dinsbydaniyal";
  record("picks first Page with linked IG (not the first Page)", passed);
  record(
    "no extra username resolution needed when Meta returns it",
    seen.length === 1,
  );
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

// Case 3: NO Page has a linked Instagram Business account — honest failure.
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