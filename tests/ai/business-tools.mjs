/**
 * Offline business-tool suite (Prompt: complete business operations).
 *
 * Exercises the REAL tool registry, entity resolution and agent instruction
 * contract without any network, secrets or business data.
 *
 * Run: node --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/ai/business-tools.mjs
 */

/* ---------------------------------------------------------------------------
 * Environment dummies (module loading only — no Supabase call is made here).
 * ------------------------------------------------------------------------ */
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://stub.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "stub-anon-key";

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const { businessTools } = await import("../../lib/ai/tools/index.ts");
const {
  resolveProduct,
  resolveCustomer,
  resolveExpense,
} = await import("../../lib/ai/tools/shared.ts");
const { buildBusinessManagerInstructions } = await import("../../lib/ai/agent.ts");
const { findById } = await import("../../lib/ai/tools/shared.ts");

/* The Agents SDK serializes tool.parameters into plain JSON Schema, so all
 * schema assertions below inspect that serialized contract (what providers
 * and the SDK actually exchange), not zod class instances. */

/* ---------------------------------------------------------------------------
 * 1. Registry completeness & uniqueness
 * ------------------------------------------------------------------------ */
const EXPECTED_TOOLS = [
  // Products & inventory
  "list_products",
  "find_product",
  "low_stock_products",
  "create_product",
  "update_product",
  "set_product_stock",
  "adjust_product_stock",
  "delete_product",
  // Customers
  "list_customers",
  "find_customer",
  "get_customer_orders",
  "create_customer",
  "update_customer",
  "delete_customer",
  // Orders & sales
  "list_orders",
  "find_order",
  "create_order",
  "update_order_status",
  "sales_summary",
  "recent_sales",
  "top_selling_products",
  // Expenses
  "list_expenses",
  "create_expense",
  "update_expense",
  "delete_expense",
  "expense_summary",
  // Whole-business view
  "business_overview",
  // Marketing
  "generate_product_caption",
  "create_ad_campaign",
  // Business settings (same capabilities as the Settings page)
  "get_business_info",
  "update_business_profile",
];
const toolNames = businessTools.map((tool) => tool.name);
const uniqueNames = new Set(toolNames);

record(
  "Registry: every expected business operation has exactly one tool",
  EXPECTED_TOOLS.every((name) => toolNames.includes(name)) &&
    uniqueNames.size === toolNames.length,
  `count=${toolNames.length}, duplicates=[${toolNames.filter((n, i) => toolNames.indexOf(n) !== i)}]`,
);

record(
  "Registry: no accidental duplicate tools beyond the approved surface",
  toolNames.length === EXPECTED_TOOLS.length,
  `registry=${toolNames.length}, expected=${EXPECTED_TOOLS.length}`,
);

record(
  "Registry: every schema is JSON-serializable with a non-empty description",
  businessTools.every(
    (tool) =>
      typeof tool.description === "string" &&
      tool.description.length >= 20 &&
      (() => {
        try {
          return JSON.stringify(tool.parameters).length > 0;
        } catch {
          return false;
        }
      })(),
  ),
);

/* ---------------------------------------------------------------------------
 * 2. Confirmation gate on destructive tools
 * ------------------------------------------------------------------------ */
const DESTRUCTIVE = ["delete_product", "delete_customer", "delete_expense"];
for (const name of [...DESTRUCTIVE, "update_order_status"]) {
  const target = businessTools.find((tool) => tool.name === name);
  const schema = /** @type {any} */ (target?.parameters ?? {});
  const confirmedProp = schema?.properties?.confirmed;
  record(
    `Confirmation: ${name} requires explicit confirmed=true (defaults to false)`,
    confirmedProp?.type === "boolean" && confirmedProp?.default === false,
    JSON.stringify(confirmedProp ?? null),
  );
}

/* ---------------------------------------------------------------------------
 * 2. Business settings tools (docs/check.txt §5 — capabilities must exist)
 * ------------------------------------------------------------------------ */
const getBusinessInfoTool = businessTools.find((tool) => tool.name === "get_business_info");
const updateBusinessProfileTool = businessTools.find(
  (tool) => tool.name === "update_business_profile",
);

record(
  "Settings: business profile is READABLE through get_business_info",
  typeof getBusinessInfoTool?.description === "string" &&
    /current/i.test(getBusinessInfoTool.description),
);

{
  const schema = /** @type {any} */ (updateBusinessProfileTool?.parameters ?? {});
  const props = Object.keys(schema?.properties ?? {});
  const expectedFields = ["name", "businessType", "currency", "language", "phone", "address"];
  record(
    "Settings: update_business_profile covers every Settings-page field",
    expectedFields.every((field) => props.includes(field)),
    `fields=[${props.join(",")}]`,
  );
  record(
    "Settings: profile update is a regular action (no confirmation gate needed)",
    !("confirmed" in (schema?.properties ?? {})),
  );
}

/* Pure merge behavior backing update_business_profile. */
const { mergeBusinessProfileUpdate } = await import(
  "../../lib/ai/tools/business-tools.ts"
);
const currentProfile = {
  name: "Test Store",
  businessType: "clothing_fashion",
  currency: "PKR",
  language: "en",
  phone: null,
  address: null,
};

record(
  "Settings merge: partial change preserves every unspecified field",
  (() => {
    const merged = mergeBusinessProfileUpdate(currentProfile, {
      name: "  New Name ",
      currency: "USD",
    });
    return (
      merged.ok &&
      merged.value.name === "New Name" &&
      merged.value.currency === "USD" &&
      merged.value.businessType === "clothing_fashion" &&
      merged.value.language === "en"
    );
  })(),
);
record(
  "Settings merge: invalid explicit values fail the whole merge (no half-update)",
  (() => {
    const badCurrency = mergeBusinessProfileUpdate(currentProfile, {
      currency: "XXX",
    });
    const badName = mergeBusinessProfileUpdate(currentProfile, { name: "" });
    const badPhone = mergeBusinessProfileUpdate(currentProfile, {
      phone: "x".repeat(31),
    });
    return !badCurrency.ok && !badName.ok && !badPhone.ok;
  })(),
);

/* Parameterless read tools keep the Groq-safe shape covered by the matrix. */
const parameterless = businessTools
  .filter((tool) => {
    const params = tool.parameters;
    return (
      params &&
      typeof params === "object" &&
      (!("properties" in params) ||
        !params.properties ||
        Object.keys(/** @type {Record<string, unknown>} */ (params.properties)).length === 0)
    );
  })
  .map((tool) => tool.name);
record(
  "Groq fixture: parameterless tools unchanged (low_stock/sales/expense/overview)",
  ["low_stock_products", "sales_summary", "expense_summary", "business_overview"].every(
    (name) => parameterless.includes(name),
  ),
  `parameterless=[${parameterless.join(",")}]`,
);

/* ---------------------------------------------------------------------------
 * 3. Product name matching (English / Roman Urdu / Urdu script / partial)
 * ------------------------------------------------------------------------ */
const products = [
  { id: "p1", name: "Banarsi Jamawar", sku: null, category: "Suits", stockQuantity: 4, lowStockThreshold: 5 },
  { id: "p2", name: "بنارسی جماوار", sku: null, category: "Suits", stockQuantity: 2, lowStockThreshold: 5 },
  { id: "p3", name: "Blue Suit", sku: "BS-01", category: "Suits", stockQuantity: 9, lowStockThreshold: 5 },
  { id: "p4", name: "Black Kurta", sku: null, category: "Kurta", stockQuantity: 0, lowStockThreshold: 3 },
  { id: "p5", name: "Banarsi Jamawar Premium", sku: null, category: "Suits", stockQuantity: 6, lowStockThreshold: 5 },
];

function first(result) {
  return result.kind === "found" ? result.item : null;
}

record(
  "Products: exact match wins regardless of capitalization/spacing",
  first(resolveProduct("  banarsi   JAMAWAR ", products))?.id === "p1",
);
record(
  "Products: Urdu-script product resolves by exact Urdu name",
  first(resolveProduct("بنارسی جماوار", products))?.id === "p2",
);
record(
  "Products: quoted query is normalized before matching",
  first(resolveProduct('"Black Kurta"', products))?.id === "p4",
);
record(
  "Products: SKU lookup works",
  first(resolveProduct("bs-01", products))?.id === "p3",
);
{
  // check.txt §18 scenario: "Banarsi Jamawar" vs "Banarsi Jamawar Premium".
  // An exact name still wins deterministically…
  record(
    "Products: exact full name beats a longer similar product",
    first(resolveProduct("Banarsi Jamawar", products))?.id === "p1",
  );
  // …while a genuinely shared fragment must ask instead of guessing.
  const ambiguous = resolveProduct("jamawar", products);
  record(
    "Products: partial multi-match returns candidates for clarification (never guesses)",
    ambiguous.kind === "ambiguous" &&
      ["p1", "p5"].every((id) => ambiguous.candidates.some((p) => p.id === id)),
  );
}
record(
  "Products: missing product reports not_found instead of inventing one",
  resolveProduct("Silk Saree", products).kind === "not_found",
);

/* ---------------------------------------------------------------------------
 * 4. Customer + expense resolution share the same robust behavior
 * ------------------------------------------------------------------------ */
const customers = [
  { id: "c1", name: "Ali Khan", phone: "0300-1234567", email: null, totalOrders: 3, totalSpent: 9000 },
  { id: "c2", name: "Ayesha", phone: "0321-7654321", email: "ayesha@example.com", totalOrders: 1, totalSpent: 2500 },
];
record(
  "Customers: phone lookup resolves the right customer",
  first(resolveCustomer("0321-7654321", customers))?.id === "c2",
);
record(
  "Customers: partial single match resolves without asking",
  first(resolveCustomer("ali", customers))?.id === "c1",
);

const expenses = [
  { id: "e1", title: "Shop Rent", amount: 40000, category: "rent" },
  { id: "e2", title: "Electricity Bill", amount: 12500, category: "utilities" },
];
record(
  "Expenses: title resolver matches case-insensitively and uniquely",
  first(resolveExpense("electricity bill", expenses))?.id === "e2",
);
record(
  "Expenses: ambiguous titles ask instead of deleting the wrong record",
  resolveExpense("bill", [
    ...expenses,
    { id: "e3", title: "Internet Bill", amount: 3500, category: "utilities" },
  ]).kind === "ambiguous",
);

/* ---------------------------------------------------------------------------
 * 5. Agent instruction contract (search-first, honesty, language rules)
 * ------------------------------------------------------------------------ */
const baseContext = {
  businessId: "biz-1",
  businessName: "Test Store",
  businessType: "clothing_fashion",
  currencyCode: "PKR",
  currencySymbol: "Rs",
  language: "en",
};

const enInstructions = buildBusinessManagerInstructions(baseContext);
record(
  "Instructions: search-before-mutate rule present",
  /SEARCH FIRST/.test(enInstructions),
);
record(
  "Instructions: ambiguity clarification rule present",
  /ask which one they mean/i.test(enInstructions),
);
record(
  "Instructions: revenue-is-not-profit honesty rule present",
  /NOT profit/i.test(enInstructions),
);
record(
  "Instructions: fresh-data-over-memory rule present",
  /fetch fresh data/i.test(enInstructions),
);
record(
  "Instructions: never claim success on failed/unconfirmed actions",
  /NEVER claim an action succeeded/.test(enInstructions),
);
record(
  "Instructions: settings capabilities are declared as existing (docs/check.txt §5)",
  /BUSINESS SETTINGS/.test(enInstructions) &&
    /capabilities DO exist/i.test(enInstructions) &&
    /read the current profile with a tool/i.test(enInstructions),
);

const urInstructions = buildBusinessManagerInstructions({
  ...baseContext,
  language: "ur",
});
record(
  "Instructions: Roman Urdu mode selects the Roman-Urdu-only reply rule",
  /Roman Urdu \(Urdu written in English letters\)/.test(urInstructions),
);
record(
  "Instructions: English mode keeps English replies while reading Roman Urdu input",
  /still reply in English/.test(enInstructions),
);

/* ---------------------------------------------------------------------------
 * 6. Ambiguity-resolution fix (docs/fix.txt): candidate IDs + id-based targeting
 * ------------------------------------------------------------------------ */

/* 6a. Ambiguous candidates must carry their real ids so the agent can target
 *     the exact record on a follow-up call instead of re-running a name search
 *     that hits the same ambiguity again. */
{
  const pAmb = resolveProduct("jamawar", products);
  record(
    "Ambiguity: product candidates carry id for follow-up targeting",
    pAmb.kind === "ambiguous" &&
      pAmb.candidates.every((c) => typeof c.id === "string" && c.id.length > 0),
  );

  const cAmb = resolveCustomer("a", [
    ...customers,
    { id: "c3", name: "Areeba", phone: null, email: null, totalOrders: 0, totalSpent: 0 },
  ]);
  record(
    "Ambiguity: customer candidates carry id for follow-up targeting",
    cAmb.kind === "ambiguous" &&
      cAmb.candidates.every((c) => typeof c.id === "string" && c.id.length > 0),
  );

  const eCands = [
    { id: "e1", title: "Shop Rent", amount: 40000, category: "rent" },
    { id: "e2", title: "Electricity Bill", amount: 12500, category: "utilities" },
    { id: "e3", title: "Internet Bill", amount: 3500, category: "utilities" },
  ];
  const eAmb = resolveExpense("bill", eCands);
  record(
    "Ambiguity: expense candidates carry id for follow-up targeting",
    eAmb.kind === "ambiguous" &&
      eAmb.candidates.every((c) => typeof c.id === "string" && c.id.length > 0),
  );
}

/* 6b. findById resolves by the exact id and refuses unknown/guessed ids
 *     (still scoped to the caller's own list, so it can never reach across
 *     businesses). */
record(
  "findById: resolves the exact id within the supplied list",
  findById(products, "p3")?.id === "p3",
);
record(
  "findById: unknown id returns null (no cross-business guess)",
  findById(products, "does-not-exist") === null,
);

/* 6c. Every affected tool's JSON schema now exposes an explicit id parameter
 *     that bypasses the ambiguous name search. */
const ID_PARAM_TOOLS = [
  ["find_product", "productId"],
  ["update_product", "productId"],
  ["set_product_stock", "productId"],
  ["adjust_product_stock", "productId"],
  ["delete_product", "productId"],
  ["find_customer", "customerId"],
  ["get_customer_orders", "customerId"],
  ["update_customer", "customerId"],
  ["delete_customer", "customerId"],
  ["update_expense", "expenseId"],
  ["delete_expense", "expenseId"],
  ["find_order", "orderId"],
  ["update_order_status", "orderId"],
];
for (const [name, idKey] of ID_PARAM_TOOLS) {
  const target = businessTools.find((tool) => tool.name === name);
  const schema = /** @type {any} */ (target?.parameters ?? {});
  const prop = schema?.properties?.[idKey];
  const acceptsString =
    prop != null &&
    (prop.type === "string" ||
      (Array.isArray(prop.anyOf) &&
        prop.anyOf.some((s) => s && s.type === "string")));
  record(`ID-param: ${name} accepts ${idKey}`, acceptsString, JSON.stringify(prop ?? null));
}

/* 6d. Agent instructions must teach the agent to resolve positional/attribute
 *     selections via the prior candidate id and to confirm only once the
 *     target is unambiguous (docs/fix.txt: disambiguate first, then confirm). */
record(
  "Instructions: disambiguate-by-id rule present (use prior candidate id, do not re-search)",
  /DISAMBIGUATION BY ID/.test(enInstructions) &&
    /RE-CALL the same tool passing that candidate's exact id/.test(enInstructions),
);
record(
  "Instructions: confirm only once target is unambiguous (ordering fix)",
  /disambiguate first, then confirm exactly once/.test(enInstructions),
);

/* 7. create_order status must tolerate the model's natural completion word.
 *    One-message "create + complete" requests (e.g. "<customer> ka order <qty>
 *    <product> order complete krdo") made the model send status="complete",
 *    which the old z.enum(["pending","completed"]) threw on at parse time. The
 *    SDK swallowed that into a generic error-as-result, so the order was never
 *    created and the model fabricated a vague "system issue" reply
 *    (docs/fix.txt). The serialized schema must now accept "complete". */
{
  const createOrderTool = businessTools.find((tool) => tool.name === "create_order");
  const schema = /** @type {any} */ (createOrderTool?.parameters ?? {});
  const statusProp = schema?.properties?.status;
  const statusEnum =
    statusProp?.enum ??
    (Array.isArray(statusProp?.anyOf) && statusProp.anyOf[0]?.enum) ??
    null;
  record(
    "create_order: status schema accepts natural 'complete' (no parse-time throw)",
    Array.isArray(statusEnum) && statusEnum.includes("complete"),
    JSON.stringify(statusEnum ?? null),
  );
}

/* ---------------------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------------------ */
const failed = results.filter((r) => !r.passed);
console.log("\n===== SUMMARY =====");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
