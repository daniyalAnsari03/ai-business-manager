/**
 * Offline unit tests for the product form helpers
 * (docs/p4.txt — File 3 / Prompt 4).
 *
 * These helpers are the glue between what is STORED on a product and what the
 * owner sees in the add/edit form. They are pure TypeScript with no I/O, so
 * these tests need no database, no Supabase and no network.
 *
 * The four things that must never go wrong are pinned here:
 *
 *  1. Loading a saved product shows exactly what was saved.
 *  2. Saving sends the owner's own spelling, never a guess or a re-label.
 *  3. An edit patches only the keys it changed — including "clear this one".
 *  4. A business type with no attribute vocabulary gets no attribute fields.
 *
 * Run: npm run test:attribute-form
 */

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const {
  ATTRIBUTE_VALUE_MAX_LENGTH,
  CLOTHING_ATTRIBUTE_KEYS,
} = await import("../../lib/business/product-attributes.ts");
const { UNIT_MAX_LENGTH, DEFAULT_UNIT } = await import(
  "../../lib/business/product-units.ts"
);
const {
  CUSTOM_VALUE,
  attributeChipValues,
  buildAttributePayload,
  buildCostPriceExtras,
  clothingFieldsFromAttributes,
  clothingOptionEntries,
  isEmptyAttributePayload,
  optionFieldValue,
  unitFieldFromLabel,
  unitOptionEntries,
  validateAttributeFields,
  validateCostPriceField,
  validateUnitField,
} = await import("../../lib/products/attribute-form.ts");

const json = (value) => JSON.stringify(value);

const CLOTHING = "clothing_fashion";

/**
 * Every business type WITHOUT the `fabric_attributes` capability
 * (lib/business/type-config.ts): electronics, retail_shop, grocery, services,
 * restaurant_food and other. Derived from the real list so a new business type
 * cannot slip through without this rule being checked for it.
 */
const { BUSINESS_TYPES } = await import("../../lib/business/constants.ts");
const NON_CLOTHING_TYPES = BUSINESS_TYPES.filter((type) => type !== CLOTHING);

/* ---------------------------------------------------------------------------
 * 1. The pickers offer every value the server accepts, plus one custom choice.
 * ------------------------------------------------------------------------ */

{
  const fabricEntries = clothingOptionEntries("fabric");
  const values = fabricEntries.map((entry) => entry.value);
  record(
    "a fabric picker offers the server's options and exactly one custom choice",
    values.filter((value) => value === CUSTOM_VALUE).length === 1 &&
      fabricEntries.filter((entry) => entry.custom).length === 1 &&
      !values.includes("") &&
      values.includes("Cotton"),
    `values=${json(values)}`,
  );
}

{
  // The escape-hatch entry ("Other"/"Custom") must not appear as a REAL option:
  // picking it is how the owner says "none of these", and the form's own
  // translated custom choice is the way to type their own value.
  const fabricEntries = clothingOptionEntries("fabric");
  const unitEntries = unitOptionEntries();
  record(
    "the escape-hatch label is not offered as a real option (it is a placeholder choice)",
    !fabricEntries.some((entry) => entry.value === "Other") &&
      !unitEntries.some((entry) => entry.value === "Other"),
    `fabric=${json(fabricEntries.map((e) => e.value))} unit=${json(unitEntries.map((e) => e.value))}`,
  );
}

{
  const unitEntries = unitOptionEntries();
  const values = unitEntries.map((entry) => entry.value);
  record(
    "a unit picker offers Piece, Meter, Yard, Set, Dozen plus one custom choice",
    values.includes(DEFAULT_UNIT) &&
      values.includes("Meter") &&
      values.includes("Dozen") &&
      values.filter((value) => value === CUSTOM_VALUE).length === 1,
    `values=${json(values)}`,
  );
}

/* ---------------------------------------------------------------------------
 * 2. Loading a saved product shows exactly what was saved.
 * ------------------------------------------------------------------------ */

{
  const fields = clothingFieldsFromAttributes({
    fabric: "Cotton",
    color: "Chikankari Special",
  });
  record(
    "a saved option value comes back as that option",
    fields.fabric.choice === "Cotton" && fields.fabric.custom === "",
    json(fields.fabric),
  );
  record(
    "a saved value that is not in the list comes back as the owner's own text",
    fields.color.choice === CUSTOM_VALUE && fields.color.custom === "Chikankari Special",
    json(fields.color),
  );
}

{
  // Canonical matching is the server's, not the form's: whatever spelling the
  // validator accepted must open as the option it was saved as.
  const fields = clothingFieldsFromAttributes({ fabric: "cotton", size: " FREE SIZE " });
  record(
    "a saved value still opens as its option despite different casing/whitespace",
    fields.fabric.choice === "Cotton" && fields.size.choice === "Free Size",
    json({ fabric: fields.fabric, size: fields.size }),
  );
}

{
  const fields = clothingFieldsFromAttributes({});
  record(
    "a product with no attributes opens every attribute as 'not set'",
    CLOTHING_ATTRIBUTE_KEYS.every(
      (key) => fields[key].choice === "" && fields[key].custom === "",
    ),
    json(fields),
  );
}

{
  const fields = clothingFieldsFromAttributes({ fabric: "   " });
  record(
    "a blank stored value opens as 'not set' instead of an empty chip",
    fields.fabric.choice === "" && fields.fabric.custom === "",
    json(fields.fabric),
  );
}

{
  record(
    "a product with no unit opens on the default unit",
    unitFieldFromLabel(null).choice === DEFAULT_UNIT &&
      unitFieldFromLabel("").choice === DEFAULT_UNIT,
    json({ null: unitFieldFromLabel(null), empty: unitFieldFromLabel("") }),
  );
  record(
    "a saved unit opens as that unit",
    unitFieldFromLabel("Meter").choice === "Meter" && unitFieldFromLabel("Meter").custom === "",
    json(unitFieldFromLabel("Meter")),
  );
  record(
    "a saved custom unit opens in the custom box",
    unitFieldFromLabel("Bundle").choice === CUSTOM_VALUE &&
      unitFieldFromLabel("Bundle").custom === "Bundle",
    json(unitFieldFromLabel("Bundle")),
  );
}

/* ---------------------------------------------------------------------------
 * 3. Saving sends the owner's own spelling — never a guess, never a re-label.
 * ------------------------------------------------------------------------ */

{
  const fields = clothingFieldsFromAttributes({});
  fields.fabric = { choice: CUSTOM_VALUE, custom: "  Chikankari  " };
  const payload = buildAttributePayload({}, fields);
  record(
    "a custom value is sent with its own words intact (padding trimmed, never re-labelled)",
    json(payload.attributes) === json({ fabric: "Chikankari" }) &&
      json(payload.clearAttributes) === json([]),
    json(payload),
  );
}

{
  const fields = clothingFieldsFromAttributes({});
  fields.fabric = { choice: "Lawn", custom: "" };
  const payload = buildAttributePayload({}, fields);
  record(
    "a picked option is sent as the option's canonical stored value",
    json(payload.attributes) === json({ fabric: "Lawn" }),
    json(payload),
  );
}

{
  // THE POINT of the patch: an owner who only renames a product must not have
  // their attributes rewritten — let alone wiped — by fields they never touched.
  const fields = clothingFieldsFromAttributes({ fabric: "Cotton", color: "Black" });
  const payload = buildAttributePayload({ fabric: "Cotton", color: "Black" }, fields);
  record(
    "an untouched product produces an empty patch, not a rewrite",
    isEmptyAttributePayload(payload) && json(payload) === json({ attributes: {}, clearAttributes: [] }),
    json(payload),
  );
  const recased = clothingFieldsFromAttributes({ fabric: "cotton" });
  record(
    "a difference only in case/spacing is not sent again (it is what the server normalises)",
    isEmptyAttributePayload(buildAttributePayload({ fabric: "cotton" }, recased)),
    json(buildAttributePayload({ fabric: "cotton" }, recased)),
  );
}

{
  // The owner cleared one box on purpose: that key must be named for removal,
  // otherwise the service has no way to know it should go.
  const fields = clothingFieldsFromAttributes({ fabric: "Cotton", color: "Black" });
  fields.color = { choice: "", custom: "" };
  const payload = buildAttributePayload({ fabric: "Cotton", color: "Black" }, fields);
  record(
    "clearing one attribute names exactly that key for removal",
    json(payload.attributes) === json({}) &&
      json(payload.clearAttributes) === json(["color"]),
    json(payload),
  );
}

{
  const fields = clothingFieldsFromAttributes({ fabric: "Cotton", color: "Black" });
  fields.color = { choice: "", custom: "" };
  fields.size = { choice: CUSTOM_VALUE, custom: "Free Size" };
  const payload = buildAttributePayload({ fabric: "Cotton", color: "Black" }, fields);
  record(
    "a set and a cleared key travel in the same patch without clashing",
    json(payload.attributes) === json({ size: "Free Size" }) &&
      json(payload.clearAttributes) === json(["color"]),
    json(payload),
  );
}

{
  // Never send a blank value: the service treats "" as "not supplied", so a
  // blank would be stored as a literal empty string instead of being removed.
  const fields = clothingFieldsFromAttributes({});
  fields.fabric = { choice: CUSTOM_VALUE, custom: "   " };
  record(
    "a custom box that was opened but left blank sends nothing",
    isEmptyAttributePayload(buildAttributePayload({}, fields)),
    json(buildAttributePayload({}, fields)),
  );
}

{
  record(
    "the unit picker resolves to a plain stored label, and an unset unit to nothing",
    optionFieldValue({ choice: "Meter", custom: "" }) === "Meter" &&
      optionFieldValue({ choice: CUSTOM_VALUE, custom: " Bundle " }) === "Bundle" &&
      optionFieldValue({ choice: "", custom: "" }) === "",
    json([
      optionFieldValue({ choice: "Meter", custom: "" }),
      optionFieldValue({ choice: CUSTOM_VALUE, custom: " Bundle " }),
      optionFieldValue({ choice: "", custom: "" }),
    ]),
  );
  record(
    "a unit is never left unset by the form (the field opens on the default)",
    unitFieldFromLabel(undefined).choice === DEFAULT_UNIT &&
      optionFieldValue(unitFieldFromLabel(undefined)) === DEFAULT_UNIT,
    json(unitFieldFromLabel(undefined)),
  );
}

/* ---------------------------------------------------------------------------
 * 4. The attribute chips a card shows: only real values, in a fixed order.
 * ------------------------------------------------------------------------ */

{
  const chips = attributeChipValues({ fabric: "Cotton", color: "Black", design: "" });
  record(
    "chips show the saved values only, and nothing for a plain product",
    json(chips) === json(["Cotton", "Black"]) && attributeChipValues({}).length === 0,
    `chips=${json(chips)} empty=${json(attributeChipValues({}))}`,
  );
  const trimmed = attributeChipValues({ fabric: "  Cotton  ", mystery: "Blue" });
  record(
    "chips are trimmed, and an unknown stored key is never invented into a chip",
    json(trimmed) === json(["Cotton"]),
    json(trimmed),
  );
}

/* ---------------------------------------------------------------------------
 * 5. Validation: the form asks the SERVICE validator, in the owner's language.
 * ------------------------------------------------------------------------ */

{
  const clean = clothingFieldsFromAttributes({ fabric: "Cotton" });
  record(
    "a valid clothing form reports no attribute errors",
    json(validateAttributeFields(CLOTHING, clean)) === json({}),
    json(validateAttributeFields(CLOTHING, clean)),
  );
}

{
  const long = clothingFieldsFromAttributes({});
  long.fabric = { choice: CUSTOM_VALUE, custom: "x".repeat(ATTRIBUTE_VALUE_MAX_LENGTH + 1) };
  const errors = validateAttributeFields(CLOTHING, long);
  record(
    "an over-long custom value is a field error the form can localise",
    errors.fabric === "too_long" && !("color" in errors),
    json(errors),
  );
}

{
  // A business type with no vocabulary must not be asked about clothing fields
  // at all — including for values that were saved while it still had them, and
  // for EVERY such type, not just one convenient one.
  const stale = clothingFieldsFromAttributes({ fabric: "Cotton", color: "Black" });
  for (const businessType of NON_CLOTHING_TYPES) {
    record(
      `${businessType}: a business type without the capability has no attribute fields to validate`,
      json(validateAttributeFields(businessType, stale)) === json({}),
      json(validateAttributeFields(businessType, stale)),
    );
  }
}

{
  record(
    "a unit longer than the service allows is a field error",
    validateUnitField({ choice: CUSTOM_VALUE, custom: "x".repeat(UNIT_MAX_LENGTH + 1) }) ===
      "too_long" &&
      validateUnitField({ choice: "Meter", custom: "" }) === null,
    json(validateUnitField({ choice: CUSTOM_VALUE, custom: "x".repeat(UNIT_MAX_LENGTH + 1) })),
  );
}

{
  record(
    "the cost price is optional, and a blank is not an error",
    validateCostPriceField("") === null &&
      validateCostPriceField("   ") === null &&
      validateCostPriceField("2400.50") === null,
    json([
      validateCostPriceField(""),
      validateCostPriceField("   "),
      validateCostPriceField("2400.50"),
    ]),
  );
}

{
  // Erasing a recorded cost price is its own explicit instruction (docs/p5.txt).
  // An empty box on its own must never mean "delete it" — that is the whole
  // reason the removal has its own flag.
  record(
    "an empty cost price box with no removal request sends nothing at all",
    json(buildCostPriceExtras("", false)) === json({}) &&
      json(buildCostPriceExtras("   ", false)) === json({}),
    json([buildCostPriceExtras("", false), buildCostPriceExtras("   ", false)]),
  );
  record(
    "only the explicit removal control erases the cost price",
    json(buildCostPriceExtras("", true)) === json({ clearCostPrice: true }),
    json(buildCostPriceExtras("", true)),
  );
  record(
    "a typed amount is sent as the cost price and cancels a pending removal",
    json(buildCostPriceExtras("2400.50", false)) === json({ costPrice: "2400.50" }) &&
      json(buildCostPriceExtras("2400.50", true)) === json({ costPrice: "2400.50" }),
    json([buildCostPriceExtras("2400.50", false), buildCostPriceExtras("2400.50", true)]),
  );
}

{
  // The messages the field errors point at must exist for both languages, or
  // the form would show an empty error where the owner expects an explanation.
  const { dictionaries } = await import("../../lib/i18n/dictionary.ts");
  const codes = ["required", "too_long"];
  const missing = codes.filter(
    (code) =>
      !dictionaries.en.products.form.fieldErrors[code] ||
      !dictionaries.ur.products.form.fieldErrors[code],
  );
  record(
    "every attribute/unit/cost error code has an English and a Roman Urdu message",
    missing.length === 0,
    `missing=${json(missing)}`,
  );
  const labels = ["product_type", "fabric", "color", "design", "size"];
  const untranslated = labels.filter(
    (key) =>
      !dictionaries.en.products.form.attributeLabels[key] ||
      !dictionaries.ur.products.form.attributeLabels[key],
  );
  record(
    "every clothing attribute has a label in both languages",
    untranslated.length === 0,
    `missing=${json(untranslated)}`,
  );
  // The cost-price removal control must be understandable in both languages, or
  // the owner is asked to press a button they cannot read (docs/p5.txt).
  const removalKeys = ["costPriceRemoveButton", "costPriceKeepButton", "costPriceRemovingHint"];
  const missingRemoval = removalKeys.filter(
    (key) => !dictionaries.en.products.form[key] || !dictionaries.ur.products.form[key],
  );
  record(
    "the cost price removal control is labelled in both languages",
    missingRemoval.length === 0,
    `missing=${json(missingRemoval)}`,
  );
}

/* =========================================================================== */

const failed = results.filter((result) => !result.passed);
console.log("\n===== SUMMARY =====");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("failed checks:");
  for (const result of failed) console.log(`  - ${result.name}`);
  process.exit(1);
}