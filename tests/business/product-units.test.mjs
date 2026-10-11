/**
 * Offline unit tests for the product unit label module
 * (docs/p1.txt — File 3 / Phase 2).
 *
 * The module is pure TypeScript with no I/O, so these tests need no database,
 * no Supabase and no network.
 *
 * Run: npm run test:product-units
 */

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const { UNIT_OPTIONS, UNIT_MAX_LENGTH, DEFAULT_UNIT, normalizeUnit } =
  await import("../../lib/business/product-units.ts");

/** Returns the stored label, or throws — for the cases that must pass. */
function ok(input) {
  const result = normalizeUnit(input);
  if (!result.ok) {
    throw new Error(
      `expected ok for ${JSON.stringify(input)}, got error: ${JSON.stringify(result.error)}`,
    );
  }
  return result.unit;
}

/** Returns the error code, or throws — for the cases that must fail. */
function errorCode(input) {
  const result = normalizeUnit(input);
  if (result.ok) {
    throw new Error(`expected failure for ${JSON.stringify(input)}`);
  }
  return result.error.code;
}

/* ---------------------------------------------------------------------------
 * The declared list itself. This list is the product decision, not an
 * implementation detail: order and spelling are what a picker shows the owner,
 * so they are pinned here exactly.
 * ------------------------------------------------------------------------ */

const EXPECTED_UNITS = ["Piece", "Meter", "Yard", "Set", "Dozen", "Other"];

record(
  "UNIT_OPTIONS is exactly the agreed 6 labels in order",
  UNIT_OPTIONS.length === EXPECTED_UNITS.length &&
    EXPECTED_UNITS.every((value, i) => UNIT_OPTIONS[i] === value),
  `got=${JSON.stringify([...UNIT_OPTIONS])}`,
);

record(
  "the default unit is Piece and it is itself a valid option",
  DEFAULT_UNIT === "Piece" && UNIT_OPTIONS.includes(DEFAULT_UNIT),
  `default=${DEFAULT_UNIT}`,
);

record("the length cap is 30 characters", UNIT_MAX_LENGTH === 30, `cap=${UNIT_MAX_LENGTH}`);

/* ---------------------------------------------------------------------------
 * Round trips: every option is accepted and stored exactly as declared.
 * ------------------------------------------------------------------------ */

record(
  "every option round-trips to itself",
  UNIT_OPTIONS.every((option) => ok(option) === option),
  `options=${[...UNIT_OPTIONS].join(",")}`,
);

record(
  "the default unit normalises to itself",
  ok(DEFAULT_UNIT) === DEFAULT_UNIT,
);

/* ---------------------------------------------------------------------------
 * Canonical spelling: case-insensitive matching lands on the declared value.
 * ------------------------------------------------------------------------ */

const CASE_VARIANTS = [
  { typed: "meter", expected: "Meter" },
  { typed: "YARD", expected: "Yard" },
  { typed: "yArD", expected: "Yard" },
  { typed: "piece", expected: "Piece" },
  { typed: "SET", expected: "Set" },
  { typed: "DoZeN", expected: "Dozen" },
  { typed: "other", expected: "Other" },
  { typed: "PIECE", expected: "Piece" },
];

for (const { typed, expected } of CASE_VARIANTS) {
  record(
    `"${typed}" is stored as "${expected}"`,
    ok(typed) === expected,
    `got=${JSON.stringify(ok(typed))}`,
  );
}

record(
  "every option matches its own upper-case form",
  UNIT_OPTIONS.every((option) => ok(option.toUpperCase()) === option),
);

/* ---------------------------------------------------------------------------
 * Whitespace normalisation.
 * ------------------------------------------------------------------------ */

record("surrounding whitespace is trimmed", ok("  Meter  ") === "Meter", `got=${JSON.stringify(ok("  Meter  "))}`);

record(
  "internal whitespace is collapsed to one space",
  ok("  Per    Piece  ") === "Per Piece",
  `got=${JSON.stringify(ok("  Per    Piece  "))}`,
);

record(
  "tabs and newlines count as whitespace",
  ok("Box\tof\nSix") === "Box of Six",
  `got=${JSON.stringify(ok("Box\tof\nSix"))}`,
);

record(
  "an option is still matched after trimming tabs and case folding",
  ok("\t meter \n") === "Meter",
  `got=${JSON.stringify(ok("\t meter \n"))}`,
);

record(
  "collapsing whitespace cannot turn a custom value into an option",
  ok("Carton   of   6") === "Carton of 6",
  `got=${JSON.stringify(ok("Carton   of   6"))}`,
);

/* ---------------------------------------------------------------------------
 * Custom values are accepted alongside the predefined ones.
 * ------------------------------------------------------------------------ */

const CUSTOM_VALUES = ["Carton", "Bundle", "Pair", "Bag", "Kg", "Litre", "Box of 12"];

for (const value of CUSTOM_VALUES) {
  record(
    `custom value "${value}" is kept as typed`,
    ok(value) === value,
    `got=${JSON.stringify(ok(value))}`,
  );
}

record(
  "a custom value keeps its own casing (only known options are canonicalised)",
  ok("Khaddar Bolt") === "Khaddar Bolt",
  `got=${JSON.stringify(ok("Khaddar Bolt"))}`,
);

record(
  "a custom value of exactly 30 characters is accepted",
  ok("x".repeat(30)) === "x".repeat(30),
);

record(
  "the 30 character limit is measured after normalisation",
  ok(`   ${"x".repeat(30)}   `) === "x".repeat(30),
  `got length=${ok(`   ${"x".repeat(30)}   `).length}`,
);

/* ---------------------------------------------------------------------------
 * Rejections. Note what is NOT here: there is no "not provided" default.
 * ------------------------------------------------------------------------ */

record(
  "31 characters is rejected",
  errorCode("x".repeat(31)) === "too_long",
  `code=${errorCode("x".repeat(31))}`,
);

record(
  "too-long is measured after trimming, not before",
  errorCode(`  ${"x".repeat(31)}  `) === "too_long",
);

record(
  "a padded 30 character label is accepted while a padded 31 character one is not",
  ok(`  ${"x".repeat(30)}  `) === "x".repeat(30) &&
    errorCode(`  ${"x".repeat(31)}  `) === "too_long",
);

record("empty string is rejected", errorCode("") === "empty", `code=${errorCode("")}`);

record(
  "whitespace-only is rejected",
  errorCode("   ") === "empty",
  `code=${errorCode("   ")}`,
);

record(
  "tabs and newlines only are rejected",
  errorCode("\t\n  ") === "empty",
  `code=${errorCode("\t\n  ")}`,
);

const NON_STRINGS = [
  ["undefined", undefined],
  ["null", null],
  ["number 5", 5],
  ["boolean true", true],
  ["object {}", {}],
  ['array ["Piece"]', ["Piece"]],
  ["function", () => "Piece"],
  ["NaN", NaN],
];

for (const [label, value] of NON_STRINGS) {
  record(
    `non-string ${label} is rejected`,
    errorCode(value) === "not_a_string",
    `code=${errorCode(value)}`,
  );
}

record(
  "an empty string is never silently replaced by the default unit",
  errorCode("") !== undefined && normalizeUnit("").ok === false,
);

record(
  "the default is not applied automatically — only when the caller asks for it",
  normalizeUnit(undefined).ok === false,
);

/* ---------------------------------------------------------------------------
 * Errors carry a human-readable message.
 * ------------------------------------------------------------------------ */

record(
  "every error carries a non-empty message",
  [undefined, "", "x".repeat(31)].every((value) => {
    const result = normalizeUnit(value);
    return result.ok === false && typeof result.error.message === "string" && result.error.message.length > 0;
  }),
);

/* ---------------------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------------------ */
const failed = results.filter((r) => !r.passed);
console.log("\n===== SUMMARY =====");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
