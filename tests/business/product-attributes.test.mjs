/**
 * Offline unit tests for clothing product attribute validation
 * (docs/fix.txt — File 3 / Step 2b).
 *
 * The validator is pure TypeScript with no I/O, so these tests need no
 * database, no Supabase and no network.
 *
 * Run: npm run test:product-attributes
 */

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const { CLOTHING_ATTRIBUTE_KEYS, CLOTHING_ATTRIBUTE_OPTIONS, normalizeProductAttributes } =
  await import("../../lib/business/product-attributes.ts");

/** Returns the stored attributes, or throws — for the cases that must pass. */
function ok(businessType, input) {
  const result = normalizeProductAttributes(businessType, input);
  if (!result.ok) {
    throw new Error(
      `expected ok for ${JSON.stringify(input)}, got errors: ${JSON.stringify(result.errors)}`,
    );
  }
  return result.attributes;
}

/** Returns the error codes, or throws — for the cases that must fail. */
function errors(businessType, input) {
  const result = normalizeProductAttributes(businessType, input);
  if (result.ok) {
    throw new Error(`expected failure for ${JSON.stringify(input)}`);
  }
  return result.errors.map((e) => e.code);
}

function sameAttributes(a, b) {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(b).every(([k, v]) => a[k] === v)
  );
}

/* ---------------------------------------------------------------------------
 * The declared vocabulary itself.
 * ------------------------------------------------------------------------ */

record(
  "clothing keys are product_type, fabric, color, design, size",
  CLOTHING_ATTRIBUTE_KEYS.join(",") === "product_type,fabric,color,design,size",
  `keys=${CLOTHING_ATTRIBUTE_KEYS.join(",")}`,
);

record(
  "every key has an option list",
  CLOTHING_ATTRIBUTE_KEYS.every((k) => Array.isArray(CLOTHING_ATTRIBUTE_OPTIONS[k])),
);

record(
  "option lists are not empty",
  CLOTHING_ATTRIBUTE_KEYS.every((k) => CLOTHING_ATTRIBUTE_OPTIONS[k].length > 0),
);

/* ---------------------------------------------------------------------------
 * The vocabulary itself, asserted value by value. These lists are the product
 * decision, not an implementation detail: order and spelling are what a picker
 * shows the owner, so they are pinned here.
 * ------------------------------------------------------------------------ */

/** Asserts a list is EXACTLY `expected`: same length, same order, same strings. */
function listIs(key, expected) {
  const actual = [...CLOTHING_ATTRIBUTE_OPTIONS[key]];
  const matches =
    actual.length === expected.length &&
    expected.every((value, i) => actual[i] === value);
  return {
    matches,
    detail: matches
      ? `${actual.length} values`
      : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  };
}

const EXPECTED_LISTS = {
  product_type: [
    "Suit",
    "Fabric",
    "Dupatta",
    "Shirt / Kameez",
    "Trouser",
    "Shawl",
    "Saree",
    "Lehenga",
    "Abaya",
    "Kurta / Kurti",
    "Co-ord Set",
    "Other",
  ],
  fabric: [
    "Cotton",
    "Lawn",
    "Chiffon",
    "Silk",
    "Linen",
    "Khaddar",
    "Jacquard",
    "Velvet",
    "Organza",
    "Georgette",
    "Net",
    "Cambric",
    "Khadi",
    "Other",
  ],
  design: [
    "Plain",
    "Printed",
    "Embroidered",
    "Jacquard",
    "Zari Work",
    "Handwork",
    "Sequins Work",
    "Thread Work",
    "Digital Print",
    "Block Print",
    "Embroidery + Handwork",
    "Embroidery + Zari",
    "Other",
  ],
  size: ["Small", "Medium", "Large", "XL", "XXL", "Free Size", "Custom"],
};

for (const [key, expected] of Object.entries(EXPECTED_LISTS)) {
  const { matches, detail } = listIs(key, expected);
  record(
    `${key} list is exactly the agreed ${expected.length} values in order`,
    matches,
    detail,
  );
}

record(
  "color stays a small predefined list plus 'Other'",
  listIs("color", [
    "Black",
    "White",
    "Red",
    "Blue",
    "Green",
    "Yellow",
    "Pink",
    "Purple",
    "Orange",
    "Brown",
    "Grey",
    "Beige",
    "Maroon",
    "Navy",
    "Other",
  ]).matches,
);

record(
  "'Unit' is not an attribute in this step",
  !CLOTHING_ATTRIBUTE_KEYS.includes("unit") &&
    CLOTHING_ATTRIBUTE_KEYS.every(
      (k) => !CLOTHING_ATTRIBUTE_OPTIONS[k].includes("Unit"),
    ),
);

record(
  "every option of every list round-trips to itself",
  CLOTHING_ATTRIBUTE_KEYS.every((k) =>
    CLOTHING_ATTRIBUTE_OPTIONS[k].every(
      (option) => ok("clothing_fashion", { [k]: option })[k] === option,
    ),
  ),
);

/* ---------------------------------------------------------------------------
 * Valid clothing input.
 * ------------------------------------------------------------------------ */

record(
  "valid clothing input is stored as given",
  sameAttributes(
    ok("clothing_fashion", {
      product_type: "Kurta",
      fabric: "Khaddar",
      color: "Black",
    }),
    { product_type: "Kurta", fabric: "Khaddar", color: "Black" },
  ),
);

record(
  "attributes are all optional — an empty object is valid",
  sameAttributes(ok("clothing_fashion", {}), {}),
);

record(
  "null and undefined input are treated as no attributes",
  sameAttributes(ok("clothing_fashion", null), {}) &&
    sameAttributes(ok("clothing_fashion", undefined), {}),
);

record(
  "surrounding whitespace is trimmed",
  sameAttributes(ok("clothing_fashion", { fabric: "  Cotton  " }), {
    fabric: "Cotton",
  }),
);

record(
  "all five keys can be supplied at once",
  sameAttributes(
    ok("clothing_fashion", {
      product_type: "Kurta / Kurti",
      fabric: "Cotton",
      color: "Blue",
      design: "Printed",
      size: "Medium",
    }),
    {
      product_type: "Kurta / Kurti",
      fabric: "Cotton",
      color: "Blue",
      design: "Printed",
      size: "Medium",
    },
  ),
);

/* ---------------------------------------------------------------------------
 * Canonical casing.
 * ------------------------------------------------------------------------ */

record(
  "predefined values are stored canonically, ignoring case",
  ok("clothing_fashion", { fabric: "cOtToN" }).fabric === "Cotton",
  `got=${ok("clothing_fashion", { fabric: "cOtToN" }).fabric}`,
);

record(
  "canonical casing applies to every key with options",
  CLOTHING_ATTRIBUTE_KEYS.every((k) => {
    const option = CLOTHING_ATTRIBUTE_OPTIONS[k][0];
    return ok("clothing_fashion", { [k]: option.toUpperCase() })[k] === option;
  }),
);

/* ---------------------------------------------------------------------------
 * Matching is tolerant about how a value was typed, and still lands on the one
 * canonical spelling.
 * ------------------------------------------------------------------------ */

const MATCH_VARIANTS = [
  { key: "product_type", typed: "shirt/kameez", expected: "Shirt / Kameez" },
  { key: "product_type", typed: "Shirt /Kameez", expected: "Shirt / Kameez" },
  { key: "product_type", typed: "KURTA/KURTI", expected: "Kurta / Kurti" },
  { key: "product_type", typed: "shirt  /   kameez", expected: "Shirt / Kameez" },
  { key: "product_type", typed: "co-ord set", expected: "Co-ord Set" },
  { key: "design", typed: "embroidery+handwork", expected: "Embroidery + Handwork" },
  { key: "design", typed: "Embroidery  +  Zari", expected: "Embroidery + Zari" },
  { key: "design", typed: "digital print", expected: "Digital Print" },
  { key: "size", typed: "free size", expected: "Free Size" },
  { key: "size", typed: "xl", expected: "XL" },
  { key: "size", typed: "  XXL  ", expected: "XXL" },
  { key: "fabric", typed: "khaddar", expected: "Khaddar" },
  { key: "fabric", typed: "Khaddar   Blend", expected: "Khaddar Blend" },
  { key: "color", typed: "off white", expected: "off white" },
  { key: "color", typed: "navy", expected: "Navy" },
];

for (const { key, typed, expected } of MATCH_VARIANTS) {
  const got = ok("clothing_fashion", { [key]: typed })[key];
  record(
    `${key}: "${typed}" is stored as "${expected}"`,
    got === expected,
    `got=${JSON.stringify(got)}`,
  );
}

record(
  "internal whitespace in a custom value is collapsed to one space",
  ok("clothing_fashion", { design: "  Chikankari   Special  " }).design ===
    "Chikankari Special",
  `got=${ok("clothing_fashion", { design: "  Chikankari   Special  " }).design}`,
);

record(
  "an option is still matched after whitespace collapsing",
  ok("clothing_fashion", { size: "  FREE   SIZE " }).size === "Free Size",
);

/* ---------------------------------------------------------------------------
 * Custom values are accepted alongside the predefined ones.
 * ------------------------------------------------------------------------ */

record(
  "a custom value on a key that has options is accepted",
  sameAttributes(ok("clothing_fashion", { fabric: "Khaddar Cotton Blend" }), {
    fabric: "Khaddar Cotton Blend",
  }),
);

record(
  "a custom value keeps its own casing (only known options are canonicalised)",
  ok("clothing_fashion", { design: "Chikankari Special" }).design ===
    "Chikankari Special",
  `got=${ok("clothing_fashion", { design: "Chikankari Special" }).design}`,
);

record(
  "a custom value of exactly 60 characters is accepted",
  sameAttributes(ok("clothing_fashion", { color: "x".repeat(60) }), {
    color: "x".repeat(60),
  }),
);

record(
  "the 60 character limit is measured after normalisation",
  sameAttributes(ok("clothing_fashion", { fabric: `   ${"x".repeat(60)}   ` }), {
    fabric: "x".repeat(60),
  }),
);

/* ---------------------------------------------------------------------------
 * Rejections.
 * ------------------------------------------------------------------------ */

record(
  "unknown key is rejected",
  errors("clothing_fashion", { material: "Cotton" }).includes("unknown_key"),
  `codes=${errors("clothing_fashion", { material: "Cotton" })}`,
);

record(
  "unknown key is rejected even alongside a valid key",
  errors("clothing_fashion", { fabric: "Cotton", brand: "A" }).includes(
    "unknown_key",
  ),
);

record("non-string value is rejected", errors("clothing_fashion", { size: 3 }).includes("not_a_string"));
record("null value is rejected", errors("clothing_fashion", { size: null }).includes("not_a_string"));
record("boolean value is rejected", errors("clothing_fashion", { size: true }).includes("not_a_string"));
record("object value is rejected", errors("clothing_fashion", { size: { m: 1 } }).includes("not_a_string"));
record("array value is rejected", errors("clothing_fashion", { size: ["M"] }).includes("not_a_string"));

record(
  "a custom value of 61 characters is rejected",
  errors("clothing_fashion", { color: "x".repeat(61) }).includes("too_long"),
  `codes=${errors("clothing_fashion", { color: "x".repeat(61) })}`,
);

record(
  "too-long value is rejected",
  errors("clothing_fashion", { fabric: "x".repeat(61) }).includes("too_long"),
  `codes=${errors("clothing_fashion", { fabric: "x".repeat(61) })}`,
);

record(
  "too-long value is measured after trimming",
  errors("clothing_fashion", { fabric: `  ${"x".repeat(61)}  ` }).includes(
    "too_long",
  ),
);

record(
  "a padded 60 character custom value is accepted, a padded 61 character one is not",
  sameAttributes(ok("clothing_fashion", { design: `  ${"x".repeat(60)}  ` }), {
    design: "x".repeat(60),
  }) &&
    errors("clothing_fashion", { design: `  ${"x".repeat(61)}  ` }).includes(
      "too_long",
    ),
);

record(
  "an array is not an attributes object",
  errors("clothing_fashion", ["Kurta"]).includes("not_an_object"),
);

record(
  "a scalar is not an attributes object",
  errors("clothing_fashion", "Kurta").includes("not_an_object"),
);

record("all problems are reported, not just the first", (() => {
  const codes = errors("clothing_fashion", {
    material: "Cotton",
    size: 3,
    fabric: "x".repeat(61),
  });
  return (
    codes.length === 3 &&
    codes.includes("unknown_key") &&
    codes.includes("not_a_string") &&
    codes.includes("too_long")
  );
})());

record(
  "errors name the offending key",
  (() => {
    const result = normalizeProductAttributes("clothing_fashion", {
      material: "Cotton",
    });
    return !result.ok && result.errors[0].key === "material";
  })(),
);

/* ---------------------------------------------------------------------------
 * Empty strings are dropped, never stored.
 * ------------------------------------------------------------------------ */

record(
  "empty string is dropped",
  sameAttributes(ok("clothing_fashion", { fabric: "Cotton", color: "" }), {
    fabric: "Cotton",
  }),
);

record(
  "whitespace-only value is dropped",
  sameAttributes(ok("clothing_fashion", { design: "   " }), {}),
);

record(
  "all-empty input yields an empty object, not empty values",
  sameAttributes(
    ok("clothing_fashion", { product_type: "", fabric: "", color: "  " }),
    {},
  ),
);

/* ---------------------------------------------------------------------------
 * Business types without the capability.
 * ------------------------------------------------------------------------ */

record(
  "electronics with non-empty attributes is rejected",
  errors("electronics", { fabric: "Cotton" }).includes(
    "not_supported_for_business_type",
  ),
  `codes=${errors("electronics", { fabric: "Cotton" })}`,
);

record(
  "electronics with {} is accepted",
  sameAttributes(ok("electronics", {}), {}),
);

record(
  "electronics with null is accepted",
  sameAttributes(ok("electronics", null), {}),
);

record(
  "electronics with a blank value is still rejected (it is not an empty object)",
  errors("electronics", { fabric: "" }).includes(
    "not_supported_for_business_type",
  ),
);

record(
  "every non-clothing business type requires an empty object",
  ["electronics", "restaurant_food", "retail_shop", "grocery", "services", "other"].every(
    (type) =>
      sameAttributes(ok(type, {}), {}) &&
      errors(type, { fabric: "Cotton" }).includes(
        "not_supported_for_business_type",
      ),
  ),
);

/* ---------------------------------------------------------------------------
 * Unknown business type falls back to "other" rules.
 * ------------------------------------------------------------------------ */

record(
  "unknown business type with {} is accepted",
  sameAttributes(ok("does_not_exist", {}), {}),
);

record(
  "unknown business type with attributes is rejected like 'other'",
  errors("does_not_exist", { fabric: "Cotton" }).includes(
    "not_supported_for_business_type",
  ),
);

record(
  "undefined / null / non-string business types behave like 'other'",
  [undefined, null, "", 42, {}, []].every(
    (value) =>
      sameAttributes(ok(value, {}), {}) &&
      errors(value, { fabric: "Cotton" }).includes(
        "not_supported_for_business_type",
      ),
  ),
);

/* ---------------------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------------------ */
const failed = results.filter((r) => !r.passed);
console.log("\n===== SUMMARY =====");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
