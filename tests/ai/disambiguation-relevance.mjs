/**
 * Offline suite for disambiguation-relevance (docs/fix.txt priority bug).
 *
 * Verifies that pending disambiguation state is only carried into a turn when
 * the user's message genuinely refers to it (a short pick among candidates, or
 * a confirmation of a resolved record) — and that STALE state left over from an
 * earlier, unrelated request is correctly dropped so a previously-resolved id /
 * leftover candidate list cannot silently steer the agent toward one record
 * without re-surfacing a real ambiguity.
 *
 * Run: node --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/disambiguation-relevance.mjs
 */

const { isPendingRelevant } = await import("../../lib/ai/disambiguation-relevance.ts");

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const candidatePending = {
  tool: "find_product",
  candidates: [
    { id: "prod-clothing-0001", name: "test dup", category: "Clothing" },
    { id: "prod-fashion-0002", name: "Test Dup", category: "Fashion" },
  ],
};

const resolvedPending = {
  tool: "delete_product",
  candidates: [],
  resolvedId: "prod-clothing-0001",
};

/* --- Candidates pending + a short selection pick -> RELEVANT --- */
record(
  "candidates: positional pick 'pehla wala' is relevant",
  isPendingRelevant("pehla wala", candidatePending) === true,
);
record(
  "candidates: positional pick '2nd' is relevant",
  isPendingRelevant("2nd", candidatePending) === true,
);
record(
  "candidates: attribute pick 'clothing wala' is relevant",
  isPendingRelevant("clothing wala", candidatePending) === true,
);
record(
  "candidates: attribute pick 'fashion wala' is relevant",
  isPendingRelevant("fashion wala", candidatePending) === true,
);

/* --- Candidates pending but user opened a NEW, unrelated request -> STALE --- */
record(
  "candidates: fresh request about another product is NOT relevant (stale)",
  isPendingRelevant("Black Kurta ka stock kitna hai?", candidatePending) === false,
);
record(
  "candidates: fresh vague answer is NOT a selection -> stale",
  isPendingRelevant("han", candidatePending) === false,
);
record(
  "candidates: multi-token new ask is NOT relevant",
  isPendingRelevant("ab sales ki detail batao", candidatePending) === false,
);

/* --- ResolvedId pending + confirmation -> RELEVANT --- */
record(
  "resolvedId: 'han' confirm is relevant",
  isPendingRelevant("han", resolvedPending) === true,
);
record(
  "resolvedId: 'haan confirm' is relevant",
  isPendingRelevant("haan confirm karo", resolvedPending) === true,
);
record(
  "resolvedId: 'yes' is relevant",
  isPendingRelevant("yes", resolvedPending) === true,
);
record(
  "resolvedId: 'theek hai' is relevant",
  isPendingRelevant("theek hai", resolvedPending) === true,
);

/* --- ResolvedId pending but user opened a NEW request -> STALE (the bug) --- */
record(
  "resolvedId: fresh request for a DIFFERENT product is NOT relevant (bug case)",
  isPendingRelevant("ab test dup ka stock batao", resolvedPending) === false,
);
record(
  "resolvedId: brand new ask is NOT relevant",
  isPendingRelevant("kuch aur product dhoondo", resolvedPending) === false,
);

/* --- Nothing pending -> never relevant --- */
record(
  "empty pending is never relevant",
  isPendingRelevant("pehla wala", { tool: "", candidates: [] }) === false,
);

const failed = results.filter((r) => !r.passed);
console.log("\n===== SUMMARY =====");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
