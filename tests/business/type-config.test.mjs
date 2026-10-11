/**
 * Offline unit tests for the business type capability config
 * (docs/fix.txt — File 3 / Step 2a).
 *
 * The config is pure data with no I/O, so these tests need no database,
 * no Supabase and no network.
 *
 * Run: npm run test:type-config
 */

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const { BUSINESS_TYPES } = await import("../../lib/business/constants.ts");
const {
  BUSINESS_TYPE_CONFIG,
  getBusinessCapabilities,
  hasCapability,
} = await import("../../lib/business/type-config.ts");

/* ---------------------------------------------------------------------------
 * Coverage: every existing business type has a config.
 * ------------------------------------------------------------------------ */

for (const type of BUSINESS_TYPES) {
  record(
    `config exists for "${type}"`,
    Object.prototype.hasOwnProperty.call(BUSINESS_TYPE_CONFIG, type) &&
      Array.isArray(BUSINESS_TYPE_CONFIG[type]?.capabilities),
    `types=${BUSINESS_TYPES.length}`,
  );
}

record(
  "config covers exactly the existing business types",
  Object.keys(BUSINESS_TYPE_CONFIG).length === BUSINESS_TYPES.length,
  `keys=${Object.keys(BUSINESS_TYPE_CONFIG).join(",")}`,
);

/* ---------------------------------------------------------------------------
 * Invariant: every type has the "core" capability.
 * ------------------------------------------------------------------------ */

for (const type of BUSINESS_TYPES) {
  record(`"${type}" has core`, hasCapability(type, "core"));
}

/* ---------------------------------------------------------------------------
 * Fallback: unknown/invalid types behave like "other".
 * ------------------------------------------------------------------------ */

const otherCaps = getBusinessCapabilities("other");

record(
  "unknown type falls back to other",
  getBusinessCapabilities("does_not_exist").join(",") === otherCaps.join(","),
  `got=${getBusinessCapabilities("does_not_exist").join(",")}`,
);

record(
  "undefined / null / empty / non-string fall back to other",
  [undefined, null, "", 42, {}, []].every(
    (value) => getBusinessCapabilities(value).join(",") === otherCaps.join(","),
  ),
);

record(
  "fallback config is core only",
  otherCaps.length === 1 && otherCaps[0] === "core",
  `got=${otherCaps.join(",")}`,
);

/* ---------------------------------------------------------------------------
 * Type-specific capabilities: clothing vs electronics.
 * ------------------------------------------------------------------------ */

record(
  "clothing_fashion has fabric_attributes",
  hasCapability("clothing_fashion", "fabric_attributes"),
);

record(
  "clothing_fashion does not have serialized_inventory",
  !hasCapability("clothing_fashion", "serialized_inventory"),
);

record(
  "electronics has serialized_inventory",
  hasCapability("electronics", "serialized_inventory"),
);

record(
  "electronics does not have fabric_attributes",
  !hasCapability("electronics", "fabric_attributes"),
);

record(
  "electronics has warranty and repair_jobs",
  hasCapability("electronics", "warranty") &&
    hasCapability("electronics", "repair_jobs"),
);

record(
  "restaurant_food has recipes and kitchen_orders",
  hasCapability("restaurant_food", "recipes") &&
    hasCapability("restaurant_food", "kitchen_orders"),
);

record(
  "core-only types expose no extra capabilities",
  ["retail_shop", "grocery", "services", "other"].every(
    (type) => getBusinessCapabilities(type).length === 1,
  ),
);

/* ---------------------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------------------ */
const failed = results.filter((r) => !r.passed);
console.log("\n===== SUMMARY =====");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
