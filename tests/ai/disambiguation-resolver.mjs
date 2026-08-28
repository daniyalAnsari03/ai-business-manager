/**
 * Deterministic disambiguation-resolver suite (docs/fix.txt).
 *
 * Verifies the server-side, model-independent resolution of a user's short
 * selection ("pehla wala", "clothing wala", ...) to the EXACT candidate id, so
 * the id an agent later targets is picked by the server and handed to the model
 * as an authoritative value — rather than relying on the model to echo a long
 * uuid out of a JSON blob across turns.
 *
 * Run: node --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/disambiguation-resolver.mjs
 */

const { resolveSelectionToId } = await import("../../lib/ai/disambiguation-resolver.ts");

const pending = {
  tool: "delete_product",
  candidates: [
    {
      id: "prod-clothing-0001",
      name: "Sequence Enbroidry",
      category: "Clothing",
      price: 10000,
      stockQuantity: 100,
      sku: null,
    },
    {
      id: "prod-fashion-0002",
      name: "Sequence Enbroidry",
      category: "Fashion",
      price: 12000,
      stockQuantity: 40,
      sku: null,
    },
  ],
};

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

/* ---------------------------------------------------------------------------
 * Round-trip integrity: the ids the resolver returns must be among the ids the
 * candidate list actually carries, and resolving the SAME semantic pick always
 * maps to the SAME stable candidate — never a straggler or a guess.
 * ------------------------------------------------------------------------ */
const validIds = new Set(pending.candidates.map((c) => c.id));

// Positional picks (Roman Urdu + English + numbers), must hit the right slot.
record(
  "positional: 'pehla wala' -> first candidate",
  resolveSelectionToId("pehla wala", pending) === "prod-clothing-0001",
);
record(
  "positional: 'phela wala' (colloquial) -> first candidate",
  resolveSelectionToId("phela wala", pending) === "prod-clothing-0001",
);
record(
  "positional: 'first wala' -> first candidate",
  resolveSelectionToId("first wala", pending) === "prod-clothing-0001",
);
record(
  "positional: '1st' -> first candidate",
  resolveSelectionToId("1st", pending) === "prod-clothing-0001",
);
record(
  "positional: 'doosra wala' -> second candidate",
  resolveSelectionToId("doosra wala", pending) === "prod-fashion-0002",
);
record(
  "positional: 'second' -> second candidate",
  resolveSelectionToId("second", pending) === "prod-fashion-0002",
);
record(
  "positional: returned id is always a real candidate id",
  ["pehla", "phela wala", "first", "1st", "2nd", "doosra", "teesra wala"].every(
    (msg) => {
      const id = resolveSelectionToId(msg, pending);
      return id === null || validIds.has(id);
    },
  ),
);

// Attribute picks ("clothing wala" -> the Clothing candidate only).
record(
  "attribute: 'clothing wala' -> the Clothing candidate",
  resolveSelectionToId("clothing wala", pending) === "prod-clothing-0001",
);
record(
  "attribute: 'fashion wala' -> the Fashion candidate",
  resolveSelectionToId("fashion wala", pending) === "prod-fashion-0002",
);

// Out-of-range positional pick must NOT guess — return null, not a bad index.
record(
  "positional: out-of-range pick returns null (no silent guess)",
  resolveSelectionToId("chautha wala", pending) === null,
);

// Empty / non-selection messages must NOT resolve to an id (so the model only
// targets when the user clearly picked one of the listed candidates).
record(
  "non-selection: plain reply returns null (no false targeting)",
  ["han", "delete", "kaun se hain", "aur batao"].every(
    (msg) => resolveSelectionToId(msg, pending) === null,
  ),
);

// No candidates -> never resolves.
record(
  "no candidates: returns null",
  resolveSelectionToId("pehla wala", {
    tool: "delete_product",
    candidates: [],
  }) === null,
);

/* ---------------------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------------------ */
const failed = results.filter((r) => !r.passed);
console.log("\n===== SUMMARY =====");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
