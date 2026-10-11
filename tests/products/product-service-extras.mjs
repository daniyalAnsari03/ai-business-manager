/**
 * Offline test of the REAL product service's new business-type-specific fields
 * (docs/p2.txt — attributes, unit label, cost price).
 *
 * lib/products/service.ts and lib/products/validation.ts run UNCHANGED here:
 * only the session (Supabase client) and the owned business are replaced with
 * in-memory stubs. That is what makes these checks meaningful — the merge rule,
 * the removal rule, the business-type gate, the honest defaults and the
 * "only write the column the caller asked for" rule are the shipped code, not a
 * re-implementation.
 *
 * The tools' own flat-parameter mapping and the audit rows are proven
 * separately in tests/ai/audit-log-tools.mjs.
 *
 * Run: npm run test:product-service
 */

/* ---------------------------------------------------------------------------
 * Environment dummies (module loading only — no network is used here).
 * ------------------------------------------------------------------------ */
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://stub.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "stub-anon-key";

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed: Boolean(passed) });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const { db, productRow, resetDb } = await import("./supabase-memory.mjs");
const { createProduct, updateProduct, getProduct, getProducts } = await import(
  "../../lib/products/service.ts"
);
const { BUSINESS_TYPES } = await import("../../lib/business/constants.ts");

/**
 * Every business type WITHOUT the `fabric_attributes` capability
 * (lib/business/type-config.ts): electronics, retail_shop, grocery, services,
 * restaurant_food and other. The attribute rules are proven for all of them
 * rather than for one convenient type, because a rule that only holds for
 * "grocery" is a rule that can still be broken for "restaurant_food". Derived
 * from the real list so a new type cannot slip through untested.
 */
const NON_CLOTHING_TYPES = BUSINESS_TYPES.filter((type) => type !== "clothing_fashion");

const json = (value) => JSON.stringify(value);

/** A row that already exists for the session's business. */
function clothingRow(overrides = {}) {
  return productRow({
    attributes: { fabric: "Cotton", color: "Black" },
    unit: "Piece",
    cost_price: null,
    ...overrides,
  });
}

/** Minimal valid payload for both create and update. */
function payload(overrides = {}) {
  return {
    name: "Blue Suit",
    category: "Suits",
    price: 4200,
    stockQuantity: 12,
    lowStockThreshold: 5,
    ...overrides,
  };
}

/* ===========================================================================
 * 1. create: what the owner said is what gets stored
 * ========================================================================= */
{
  resetDb();
  const result = await createProduct(
    payload({
      attributes: {
        product_type: "shirt / kameez ",
        fabric: "  lawn  ",
        color: "black",
        design: "handwork",
        size: "free size",
      },
      unit: " meter ",
      costPrice: 2400.5,
    }),
  );
  record(
    "create: clothing attributes are stored in canonical spelling",
    result.ok &&
      json(result.data.attributes) ===
        json({
          product_type: "Shirt / Kameez",
          fabric: "Lawn",
          color: "Black",
          design: "Handwork",
          size: "Free Size",
        }),
    json(result.ok ? result.data.attributes : result),
  );
  record(
    "create: the unit label is canonicalised and the cost price stored",
    result.ok && result.data.unit === "Meter" && result.data.costPrice === 2400.5,
    result.ok ? `unit=${result.data.unit} costPrice=${result.data.costPrice}` : "failed",
  );
  record(
    "create: the stored row really carries those values",
    db.products.length === 1 &&
      json(db.products[0].attributes) === json(result.data.attributes) &&
      db.products[0].unit === "Meter" &&
      Number(db.products[0].cost_price) === 2400.5,
    json(db.products[0] ?? null),
  );
}

{
  resetDb();
  const result = await createProduct(
    payload({ attributes: { fabric: "Chikankari", design: "Chikankari Special" } }),
  );
  record(
    "create: a custom attribute value nobody could enumerate is accepted as typed",
    result.ok &&
      result.data.attributes.fabric === "Chikankari" &&
      result.data.attributes.design === "Chikankari Special",
    json(result.ok ? result.data.attributes : result),
  );
}

{
  resetDb();
  const result = await createProduct(payload({ attributes: { color: "" } }));
  record(
    "create: a blank attribute value is dropped instead of stored as an empty string",
    result.ok && json(result.data.attributes) === json({}),
    json(result.ok ? result.data.attributes : result),
  );
}

{
  resetDb();
  const result = await createProduct(payload());
  record(
    "create: a product with nothing clothing-related gets the HONEST defaults ({} / Piece / null)",
    result.ok &&
      json(result.data.attributes) === json({}) &&
      result.data.unit === "Piece" &&
      result.data.costPrice === null,
    result.ok
      ? `attributes=${json(result.data.attributes)} unit=${result.data.unit} costPrice=${result.data.costPrice}`
      : "failed",
  );
}

/* ===========================================================================
 * 2. create: rejected input is reported, never silently dropped
 * ========================================================================= */
{
  resetDb();
  const result = await createProduct(payload({ attributes: { fabric: "x".repeat(61) } }));
  record(
    "create: an over-long attribute fails with a clear message and writes nothing",
    !result.ok &&
      result.reason === "invalid_input" &&
      /60 characters or fewer/.test(result.detail ?? "") &&
      db.products.length === 0 &&
      db.writes.length === 0,
    `reason=${!result.ok ? result.reason : "ok"} detail=${json(!result.ok ? result.detail : null)} rows=${db.products.length}`,
  );
}

{
  resetDb();
  const result = await createProduct(payload({ attributes: { unknown_attribute: "Blue" } }));
  record(
    "create: an unknown attribute key is rejected by name",
    !result.ok && /Unknown product attribute "unknown_attribute"/.test(result.detail ?? ""),
    json(!result.ok ? result.detail : null),
  );
}

{
  resetDb();
  const result = await createProduct(payload({ unit: "   " }));
  record(
    "create: a blank unit is an error, never a silent default",
    !result.ok && /cannot be empty/.test(result.detail ?? "") && db.products.length === 0,
    json(!result.ok ? result.detail : null),
  );
}

{
  resetDb();
  const result = await createProduct(payload({ unit: "x".repeat(31) }));
  record(
    "create: an over-long unit label is rejected",
    !result.ok && /30 characters or fewer/.test(result.detail ?? ""),
    json(!result.ok ? result.detail : null),
  );
}

{
  resetDb();
  const result = await createProduct(payload({ costPrice: -5 }));
  record(
    "create: a negative cost price is rejected with a clear message",
    !result.ok && /Cost price cannot be negative/.test(result.detail ?? "") && db.products.length === 0,
    json(!result.ok ? result.detail : null),
  );
}

{
  resetDb();
  const result = await createProduct(payload({ costPrice: "abc" }));
  record(
    "create: a non-numeric cost price is rejected",
    !result.ok && /Cost price must be a number/.test(result.detail ?? ""),
    json(!result.ok ? result.detail : null),
  );
}

{
  resetDb();
  const result = await createProduct(payload({ costPrice: 0 }));
  record(
    "create: a cost price of 0 is a real value, not 'not set'",
    result.ok && result.data.costPrice === 0 && Number(db.products[0]?.cost_price) === 0,
    result.ok ? `costPrice=${result.data.costPrice}` : "failed",
  );
}

/* ===========================================================================
 * 3. The business type comes from the session, never from the payload
 *
 * Run for every business type that has no `fabric_attributes` capability.
 * ========================================================================= */
for (const businessType of NON_CLOTHING_TYPES) {
  resetDb({ businessType });
  const withAttribute = await createProduct(payload({ attributes: { color: "Red" } }));
  record(
    `${businessType}: a business type without the fabric_attributes capability rejects attributes by name`,
    !withAttribute.ok &&
      withAttribute.reason === "invalid_input" &&
      /Product attribute "color" is not supported for this business type/.test(withAttribute.detail ?? ""),
    json(!withAttribute.ok ? withAttribute.detail : null),
  );

  const withoutAttribute = await createProduct(payload({ unit: "Kg", costPrice: 120 }));
  record(
    `${businessType}: the same business type may still set a unit label and a cost price`,
    withoutAttribute.ok && withoutAttribute.data.unit === "Kg" && withoutAttribute.data.costPrice === 120,
    withoutAttribute.ok
      ? `unit=${withoutAttribute.data.unit} costPrice=${withoutAttribute.data.costPrice}`
      : json(withoutAttribute),
  );
}

/* ===========================================================================
 * 4. Read: stored values come back, and rows without them stay honest
 * ========================================================================= */
{
  const legacy = productRow({ name: "Legacy Kurta" });
  // A row written before the columns existed simply has no such keys.
  resetDb({ products: [legacy] });
  const result = await getProduct(legacy.id);
  record(
    "read: a row without the new columns maps to attributes {}, unit Piece, cost price null",
    result.ok &&
      json(result.data.attributes) === json({}) &&
      result.data.unit === "Piece" &&
      result.data.costPrice === null,
    result.ok
      ? `attributes=${json(result.data.attributes)} unit=${result.data.unit} costPrice=${result.data.costPrice}`
      : "failed",
  );
}

{
  // Attributes stored while the shop WAS a clothing shop, read back after the
  // owner changed the business type: they are HIDDEN from the owner (the type
  // no longer has the vocabulary for them) but they are not destroyed, and the
  // unit and cost price are still shown because they are not attributes. Every
  // type without the capability must behave this way, not just one.
  for (const businessType of NON_CLOTHING_TYPES) {
    const row = clothingRow({ unit: "Meter", cost_price: 900 });
    resetDb({ businessType, products: [row] });
    const result = await getProduct(row.id);
    record(
      `read: ${businessType} reads attributes as {} (no fabric_attributes capability)`,
      result.ok && json(result.data.attributes) === json({}),
      json(result.ok ? result.data.attributes : result),
    );
    record(
      `read: hiding attributes for ${businessType} keeps showing the unit and the cost price`,
      result.ok &&
        result.data.unit === "Meter" &&
        result.data.costPrice === 900,
      result.ok ? `unit=${result.data.unit} costPrice=${result.data.costPrice}` : json(result),
    );
    record(
      `read: hiding attributes for ${businessType} did not delete the stored bag`,
      json(db.products[0].attributes) === json({ fabric: "Cotton", color: "Black" }),
      json(db.products[0].attributes),
    );
    record(
      `read: hiding attributes for ${businessType} wrote nothing to the database`,
      db.writes.length === 0,
      json(db.writes),
    );
  }
}

{
  // A business that still HAS the capability is unaffected by the gating.
  const row = clothingRow();
  resetDb({ businessType: "clothing_fashion", products: [row] });
  const result = await getProduct(row.id);
  record(
    "read: a clothing shop still reads its stored attributes",
    result.ok && json(result.data.attributes) === json({ fabric: "Cotton", color: "Black" }),
    json(result.ok ? result.data.attributes : result),
  );
}

{
  // The LIST is what the products screen renders, so it must be gated by the
  // same capability — and it must still show attributes for a clothing shop.
  const clothingRowForList = clothingRow({ unit: "Meter", cost_price: 900 });
  resetDb({ businessType: "clothing_fashion", products: [clothingRowForList] });
  const clothing = await getProducts();
  record(
    "read: the product LIST keeps attributes for a clothing shop",
    clothing.ok && json(clothing.data[0].attributes) === json({ fabric: "Cotton", color: "Black" }),
    json(clothing.ok ? clothing.data[0].attributes : clothing),
  );

  for (const businessType of NON_CLOTHING_TYPES) {
    const listRow = clothingRow({ unit: "Meter", cost_price: 900 });
    resetDb({ businessType, products: [listRow] });
    const listed = await getProducts();
    record(
      `read: the product LIST hides attributes for ${businessType} (no fabric_attributes capability)`,
      listed.ok && json(listed.data[0].attributes) === json({}),
      json(listed.ok ? listed.data[0].attributes : listed),
    );
    record(
      `read: the product LIST still shows the unit and the cost price for ${businessType}`,
      listed.ok && listed.data[0].unit === "Meter" && listed.data[0].costPrice === 900,
      listed.ok ? `unit=${listed.data[0].unit} costPrice=${listed.data[0].costPrice}` : json(listed),
    );
    record(
      `read: hiding attributes in the LIST for ${businessType} wrote nothing`,
      db.writes.length === 0,
      json(db.writes),
    );
  }
}

/* ===========================================================================
 * 5. update: attributes MERGE, and removal is explicit
 * ========================================================================= */
{
  const row = clothingRow();
  resetDb({ products: [row] });
  const result = await updateProduct(row.id, payload({ attributes: { color: "Maroon" } }), {
    skipStock: true,
  });
  record(
    "update: one supplied attribute changes ONLY that key and keeps the others",
    result.ok && json(result.data.attributes) === json({ fabric: "Cotton", color: "Maroon" }),
    json(result.ok ? result.data.attributes : result),
  );
  record(
    "update: the merged attributes really replaced the stored bag",
    json(db.products[0].attributes) === json({ fabric: "Cotton", color: "Maroon" }),
    json(db.products[0].attributes),
  );
}

{
  const row = clothingRow();
  resetDb({ products: [row] });
  const result = await updateProduct(
    row.id,
    payload({ clearAttributes: ["color"] }),
    { skipStock: true },
  );
  record(
    "update: clearAttributes removes ONLY the named key",
    result.ok && json(result.data.attributes) === json({ fabric: "Cotton" }),
    json(result.ok ? result.data.attributes : result),
  );
}

{
  const row = clothingRow();
  resetDb({ products: [row] });
  const result = await updateProduct(
    row.id,
    payload({ attributes: { color: "Maroon" }, clearAttributes: ["color"] }),
    { skipStock: true },
  );
  record(
    "update: a key that is both supplied and cleared is removed, never written back",
    result.ok && json(result.data.attributes) === json({ fabric: "Cotton" }),
    json(result.ok ? result.data.attributes : result),
  );
}

{
  const row = clothingRow();
  resetDb({ products: [row] });
  const result = await updateProduct(
    row.id,
    payload({ clearAttributes: ["colour"] }),
    { skipStock: true },
  );
  record(
    "update: an unknown key in clearAttributes is rejected instead of silently ignored",
    !result.ok && /Unknown product attribute "colour"/.test(result.detail ?? ""),
    json(!result.ok ? result.detail : null),
  );
}

/* ===========================================================================
 * 6. update: an omitted extra never overwrites a stored one
 * ========================================================================= */
{
  const row = clothingRow({ unit: "Meter", cost_price: "900.00" });
  resetDb({ products: [row] });
  const result = await updateProduct(row.id, payload({ price: 4500 }), { skipStock: true });
  const patch = db.writes.at(-1)?.patch ?? {};
  record(
    "update: an edit about the price leaves the unit, cost price and attributes untouched",
    result.ok &&
      result.data.price === 4500 &&
      result.data.unit === "Meter" &&
      result.data.costPrice === 900 &&
      json(result.data.attributes) === json({ fabric: "Cotton", color: "Black" }),
    result.ok
      ? `unit=${result.data.unit} costPrice=${result.data.costPrice} attributes=${json(result.data.attributes)}`
      : "failed",
  );
  record(
    "update: the SQL patch omits the columns the caller never asked to change",
    !("unit" in patch) && !("cost_price" in patch) && !("attributes" in patch),
    json(patch),
  );
}

{
  const row = clothingRow();
  resetDb({ products: [row] });
  const result = await updateProduct(row.id, payload({ unit: "  yard " }), { skipStock: true });
  record(
    "update: the unit label is canonicalised",
    result.ok && result.data.unit === "Yard" && db.products[0].unit === "Yard",
    result.ok ? `unit=${result.data.unit}` : "failed",
  );
}

{
  const row = clothingRow();
  resetDb({ products: [row] });
  const result = await updateProduct(row.id, payload({ costPrice: 1250.456 }), { skipStock: true });
  record(
    "update: the cost price is stored with at most two decimals",
    result.ok && result.data.costPrice === 1250.46,
    result.ok ? `costPrice=${result.data.costPrice}` : "failed",
  );
}

{
  const row = clothingRow();
  resetDb({ businessType: "grocery", products: [row] });
  const patchAttributes = await updateProduct(row.id, payload({ attributes: { color: "Red" } }), {
    skipStock: true,
  });
  const clearAttributes = await updateProduct(
    row.id,
    payload({ clearAttributes: ["color"] }),
    { skipStock: true },
  );
  record(
    "update: a business type without the capability rejects an attribute patch AND a removal",
    !patchAttributes.ok &&
      /not supported for this business type/.test(patchAttributes.detail ?? "") &&
      !clearAttributes.ok &&
      /not supported for this business type/.test(clearAttributes.detail ?? ""),
    json({ patch: !patchAttributes.ok ? patchAttributes.detail : null, clear: !clearAttributes.ok ? clearAttributes.detail : null }),
  );
  record(
    "update: the rejected removal left the stored attributes alone",
    json(db.products[0].attributes) === json({ fabric: "Cotton", color: "Black" }),
    json(db.products[0].attributes),
  );
}

/* ===========================================================================
 * 7. Ownership: a payload can never choose the business or the product
 * ========================================================================= */
{
  resetDb();
  const created = await createProduct(
    payload({
      attributes: { color: "Red" },
      businessId: db.otherBusinessId,
      business_id: db.otherBusinessId,
    }),
  );
  record(
    "create: a business_id in the payload is ignored; the row belongs to the session's business",
    created.ok &&
      created.data.businessId === db.businessId &&
      db.products[0].business_id === db.businessId,
    `businessId=${created.ok ? created.data.businessId : "failed"}`,
  );
}

{
  const row = clothingRow();
  const foreign = productRow({ id: "foreign-1", business_id: db.otherBusinessId });
  resetDb({ products: [row, foreign] });
  const result = await updateProduct("foreign-1", payload({ attributes: { color: "Red" } }), {
    skipStock: true,
  });
  record(
    "update: a product belonging to another business is 'not found' and is never written",
    !result.ok && result.reason === "not_found" && db.writes.length === 0,
    `reason=${!result.ok ? result.reason : "ok"} writes=${db.writes.length}`,
  );
}

/* ===========================================================================
 * 8. Removing a recorded cost price is its own explicit instruction (docs/p5.txt)
 *
 * An omitted costPrice has always meant "leave the stored cost alone", which is
 * exactly why emptying a form field could never erase it. The removal is now an
 * additive flag: `clearCostPrice: true` writes NULL, a value is still a value,
 * and the two together are a reported contradiction instead of a guess.
 * ========================================================================= */
{
  const row = clothingRow({ cost_price: "900.00" });
  resetDb({ products: [row] });
  const result = await updateProduct(row.id, payload({ clearCostPrice: true }), {
    skipStock: true,
  });
  const patch = db.writes.at(-1)?.patch ?? {};
  record(
    "update: clearCostPrice erases a recorded cost price",
    result.ok && result.data.costPrice === null && db.products[0].cost_price === null,
    result.ok ? `costPrice=${result.data.costPrice}` : json(result),
  );
  record(
    "update: the SQL patch writes cost_price = NULL explicitly",
    "cost_price" in patch && patch.cost_price === null,
    json(patch),
  );
}

{
  // The other fields of the same edit are untouched — a removal is not a reset
  // of everything else.
  const row = clothingRow({ unit: "Meter", cost_price: 900 });
  resetDb({ products: [row] });
  const result = await updateProduct(
    row.id,
    payload({ price: 5000, attributes: { color: "Maroon" }, clearCostPrice: true }),
    { skipStock: true },
  );
  record(
    "update: erasing the cost price leaves the price, unit and attributes alone",
    result.ok &&
      result.data.price === 5000 &&
      result.data.unit === "Meter" &&
      result.data.costPrice === null &&
      json(result.data.attributes) === json({ fabric: "Cotton", color: "Maroon" }),
    json(result.ok ? result.data : result),
  );
}

{
  // The whole point of the flag: an edit that says nothing about the cost price
  // still leaves it alone, and an explicit "false" is not an instruction either.
  const row = clothingRow({ cost_price: 900 });
  resetDb({ products: [row] });
  const silent = await updateProduct(row.id, payload({ price: 4500 }), { skipStock: true });
  const explicitFalse = await updateProduct(
    row.id,
    payload({ price: 4600, clearCostPrice: false }),
    { skipStock: true },
  );
  record(
    "update: an omitted cost price leaves the stored one, and clearCostPrice:false erases nothing",
    silent.ok &&
      explicitFalse.ok &&
      silent.data.costPrice === 900 &&
      explicitFalse.data.costPrice === 900 &&
      db.products[0].cost_price === 900,
    `omitted=${silent.ok ? silent.data.costPrice : "failed"} false=${explicitFalse.ok ? explicitFalse.data.costPrice : "failed"}`,
  );
  record(
    "update: neither of those edits writes the cost_price column at all",
    !("cost_price" in (db.writes[0]?.patch ?? {})) &&
      !("cost_price" in (db.writes[1]?.patch ?? {})),
    json(db.writes.map((write) => write.patch)),
  );
}

{
  const row = clothingRow({ cost_price: 900 });
  resetDb({ products: [row] });
  const result = await updateProduct(
    row.id,
    payload({ costPrice: 500, clearCostPrice: true }),
    { skipStock: true },
  );
  record(
    "update: a new cost price together with clearCostPrice is rejected, never guessed",
    !result.ok &&
      result.reason === "invalid_input" &&
      /cannot be sent together/.test(result.detail ?? "") &&
      db.writes.length === 0 &&
      db.products[0].cost_price === 900,
    `reason=${!result.ok ? result.reason : "ok"} detail=${json(!result.ok ? result.detail : null)}`,
  );
}

{
  const row = clothingRow({ cost_price: 900 });
  resetDb({ products: [row] });
  const result = await updateProduct(row.id, payload({ clearCostPrice: "yes" }), {
    skipStock: true,
  });
  record(
    "update: a non-boolean clearCostPrice is rejected instead of being read as truthy",
    !result.ok && /explicitly/.test(result.detail ?? "") && db.writes.length === 0,
    json(!result.ok ? result.detail : null),
  );
}

{
  // Nothing to remove: the row already has no cost price. The honest result is
  // success with the value still null — and the service issues no write at all
  // beyond the fields the caller did change.
  const row = clothingRow({ cost_price: null });
  resetDb({ products: [row] });
  const result = await updateProduct(row.id, payload({ clearCostPrice: true }), {
    skipStock: true,
  });
  const patch = db.writes.at(-1)?.patch ?? {};
  record(
    "update: clearing a cost price that was never recorded leaves it null",
    result.ok && result.data.costPrice === null,
    result.ok ? `costPrice=${result.data.costPrice}` : json(result),
  );
  record(
    "update: clearing a cost price that was never recorded writes no cost_price column",
    !("cost_price" in patch) || patch.cost_price === null,
    json(patch),
  );
}

{
  // A create has no cost price to erase, so the flag changes nothing and the
  // honest default stands.
  resetDb();
  const result = await createProduct(payload({ clearCostPrice: true }));
  record(
    "create: clearCostPrice on a new product is harmless — there was never a cost to erase",
    result.ok && result.data.costPrice === null && db.products[0].cost_price === null,
    result.ok ? `costPrice=${result.data.costPrice}` : json(result),
  );
}

{
  // Business-type independence: a cost price is a commercial fact every type
  // owns, so setting AND erasing it must work the same way for all of them.
  const BUSINESS_TYPES = [
    "clothing_fashion",
    "electronics",
    "retail_shop",
    "grocery",
    "services",
    "restaurant_food",
    "other",
  ];
  const failures = [];
  for (const businessType of BUSINESS_TYPES) {
    resetDb({ businessType });
    const created = await createProduct(payload({ costPrice: 750 }));
    if (!created.ok) {
      failures.push(`${businessType}: create failed`);
      continue;
    }
    const cleared = await updateProduct(created.data.id, payload({ clearCostPrice: true }), {
      skipStock: true,
    });
    if (!cleared.ok) {
      failures.push(`${businessType}: clear failed (${cleared.reason})`);
      continue;
    }
    const written = db.writes.at(-1)?.patch ?? {};
    if (cleared.data.costPrice !== null || written.cost_price !== null) {
      failures.push(`${businessType}: costPrice=${cleared.data.costPrice} patch=${json(written)}`);
    }
  }
  record(
    "every business type can record and then erase a cost price",
    failures.length === 0,
    failures.join(" | ") || BUSINESS_TYPES.join(", "),
  );
}

{
  // The removal instruction must not become a way to reach another business.
  const row = clothingRow({ cost_price: 900 });
  const foreign = productRow({ id: "foreign-1", business_id: db.otherBusinessId, cost_price: 500 });
  resetDb({ products: [row, foreign] });
  const result = await updateProduct(
    "foreign-1",
    payload({
      clearCostPrice: true,
      businessId: db.otherBusinessId,
      business_id: db.otherBusinessId,
    }),
    { skipStock: true },
  );
  record(
    "update: a hostile business_id with clearCostPrice is still 'not found' and never written",
    !result.ok && result.reason === "not_found" && db.writes.length === 0,
    `reason=${!result.ok ? result.reason : "ok"} writes=${db.writes.length}`,
  );
  record(
    "update: the other business's cost price is untouched",
    db.products[1].cost_price === 500,
    json(db.products[1].cost_price),
  );
}

/* ---------------------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------------------ */
const failed = results.filter((r) => !r.passed);
console.log("\n===== SUMMARY =====");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
