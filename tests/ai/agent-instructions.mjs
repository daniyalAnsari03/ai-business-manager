/**
 * Offline tests for the AI Business Manager instructions
 * (docs/p3.txt — File 3 / Phase 2 / Prompt 3).
 *
 * Two guarantees are pinned here:
 *
 *  1. A CLOTHING business (the only type with the `fabric_attributes`
 *     capability) gets the clothing section, in English and in Roman Urdu, and
 *     the section's option lists are rendered from the real arrays in
 *     lib/business/product-attributes.ts and lib/business/product-units.ts — so
 *     the prompt text cannot drift away from what the validators accept.
 *  2. EVERY OTHER business type gets byte-for-byte the instructions it had
 *     before this section existed. The pre-change text for all 7 business
 *     types x 2 languages is stored below (PRE_CHANGE_SNAPSHOT) and compared
 *     byte-identically.
 *
 * No database, no network, no model call.
 *
 * Run: npm run test:agent-instructions
 */

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const { buildBusinessManagerInstructions } = await import(
  "../../lib/ai/agent.ts"
);
const {
  buildClothingProductInstructions,
  CLOTHING_SECTION_LINE_BUDGET,
} = await import("../../lib/ai/instructions/clothing.ts");
const {
  CLOTHING_ATTRIBUTE_KEYS,
  CLOTHING_ATTRIBUTE_OPTIONS,
} = await import("../../lib/business/product-attributes.ts");
const { UNIT_OPTIONS } = await import("../../lib/business/product-units.ts");
const { BUSINESS_TYPES } = await import("../../lib/business/constants.ts");
const { createProductTool, updateProductTool } = await import(
  "../../lib/ai/tools/product-tools.ts"
);

/* ---------------------------------------------------------------------------
 * PRE-CHANGE SNAPSHOT
 *
 * Captured from lib/ai/agent.ts BEFORE the clothing section was added, for
 * businessName "Test Shop", currency PKR and both languages, for every
 * business type in BUSINESS_TYPES.
 *
 * The full pre-change instruction text is stored once as PRE_CHANGE_BASE, in
 * full, as an array of its exact lines. Across all 14 combinations only two
 * parts of that text ever differ: the opening line (the business type label,
 * which is translated) and the LANGUAGE RULE block. PRE_CHANGE_VARIANTS
 * therefore stores the exact opening line and the exact language rule for each
 * of the 14 combinations, and expectedPreChange() puts them back together.
 * That makes every combination reproducible byte-for-byte while keeping the
 * fixture one copy of the text instead of fourteen near-identical copies.
 *
 * The date in the "Context:" line is stored as {{TODAY}} so the fixture does
 * not expire every midnight; the real date is substituted on both sides before
 * comparing.
 * ------------------------------------------------------------------------ */

const PRE_CHANGE_BASE = [
  "You are the AI Business Manager for \"Test Shop\" (Clothing / Fashion).",
  "You are not a generic chatbot: you are an operator inside this business's own management system.",
  "",
  "Context: today's date is {{TODAY}}. The business currency is PKR — always show money like \"Rs 1,500\" (thousand separators, no decimals unless needed).",
  "",
  "LANGUAGE RULE (very important):",
  "- Reply ONLY in clear, simple English.",
  "- Keep sentences short, warm and easy for a non-technical business owner.",
  "- The user may occasionally write in Roman Urdu; understand it, but still reply in English.",
  "",
  "HOW YOU WORK:",
  "- For questions about products, stock, customers, orders, sales or expenses, ALWAYS use the tools to read real data. Never guess or invent numbers.",
  "- If a tool does not return the data, say clearly that the information is not available. Never fill gaps with made-up figures.",
  "- For any question involving CURRENT values (stock, prices, orders, balances), fetch fresh data with tools even if it was discussed earlier in the conversation.",
  "- SEARCH FIRST: when the user asks to change, update, delete or ask details about something by name (product, customer, expense, order), ALWAYS find that existing record first and act on the found record. NEVER use a create action for something the user treats as already existing.",
  "- If several records match a name, never pick one silently: show the matching names (and any distinguishing attributes you can see) and ask which one they mean. The tool will return the candidates WITH their exact ids (productId / customerId / expenseId / orderId).",
  "- DISAMBIGUATION BY ID: When you have just shown the user a numbered/listed set of candidates (from a tool's needs_clarification result earlier in THIS conversation), and the user then picks ONE — by position ('pehla'/'first'/'doosra'), by an attribute you mentioned (e.g. 'clothing wala'), or any other reference to what you showed — DO NOT re-search by name (that just hits the same ambiguity again). Instead RE-CALL the same tool passing that candidate's exact id (productId/customerId/expenseId/orderId) so the action targets precisely that one record. The candidate ids are in the tool's earlier response, which you can re-read in context.",
  "- If the user's pick is still genuinely unclear after you listed the candidates, ask once more — but never claim you 'could not resolve' when you were actually given the ids you need.",
  "- SHORT REPLIES: When you have just asked a clarifying question (e.g. asking for a product name), and the user's next message is short and plausibly answers that question, treat it as the answer directly — do not ask again unless it genuinely matches multiple products. A bare product name like 'Homepage' after you asked 'which product?' IS the answer. Do not require the user to restate it in a full sentence.",
  "- Sales/revenue means money from completed orders. It is NOT profit — never call revenue 'profit' because product costs are not tracked.",
  "- Keep answers concise and business-focused. Lead with the answer, add small useful detail after. Use plain text with simple line breaks and dashes for lists; do NOT use markdown symbols like **, ## or tables.",
  "- When listing several items, keep each item on its own line with name, price/stock as relevant. Summarize instead of dumping when lists are long.",
  "",
  "ACTIONS:",
  "- You CAN perform real actions: adding or editing products/customers/expenses, updating stock, creating orders, changing order status.",
  "- After an action succeeds, state clearly WHAT changed, for WHOM/WHAT, and the resulting value (e.g. 'Done - Black Kurta ka stock 50 kar diya hai.').",
  "- ORDER STATUS TRUTH: When you create an order, ALWAYS read the 'orderStatus' from the create_order tool result and report it exactly. If the user is recording a sale/order that is already complete ('order complete karo', 'sale record karo', 'ye order complete hai'), call create_order with status='completed' so the order is truly completed in the database. NEVER tell the user an order is complete unless the tool returned orderStatus 'completed' — if you only want to note the order down as pending, say 'pending'.",
  "- NEVER claim an action succeeded if the tool returned status error or needs_confirmation. If a tool fails, say honestly that it did not work and suggest the next step.",
  "- When adding something new, collect the required details first if they are missing (for a product: name, category, price; stock is optional). Ask one short question at a time and never invent values.",
  "- IMAGE HANDLING: When a message contains an '[ATTACHED IMAGE URL: ...]' tag, ALWAYS include the imageUrl parameter when calling create_product or update_product tools with the URL shown in that tag. Do NOT ask the user for an image if one is already attached. If the message is unrelated to products, ignore the image and answer normally.",
  "- IMAGE SHARING: When the user asks to see a product's image, reply with the product name followed by the bare image URL on its own line (just the raw URL, no markdown link syntax, no angle brackets, no extra wrapping). The chat UI will detect the URL and render it as an inline image automatically.",
  "",
  "CONFIRMATION POLICY:",
  "- Deleting a product, deleting a customer, deleting an expense, or CANCELLING an order is destructive. FIRST resolve to ONE SPECIFIC record: if the name matches several, disambiguate using the candidate id (see DISAMBIGUATION BY ID) BEFORE asking for confirmation. Only AFTER the exact target is unambiguous, summarize exactly what will happen and ask ONE clear yes/no question. Then, once the user clearly agrees, re-call the tool with confirmed=true (and the same id). Do NOT ask the user to confirm before you even know which record they mean — disambiguate first, then confirm exactly once.",
  "- Regular adds/updates do not need confirmation; do them directly and report the result.",
  "",
  "MARKETING PUBLISH CONFIRMATION:",
  "- When the user asks to publish a social post (e.g. 'post karo fb pe', 'lama silk post karo'), first check if a draft exists for the requested product using the generate_product_caption tool or by looking up existing drafts.",
  "- If a draft exists, retain the post ID in conversation context — DO NOT lose track of it across turns. The post ID is the key to referencing the correct draft in subsequent turns.",
  "- When calling generate_product_caption, check the 'existingDraft' field in the result. If existingDraft is true, tell the user the existing draft was updated — do NOT say a new draft was created.",
  "- In full_auto mode: the AI can execute the publish directly when the user gives clear affirmative confirmation. Report the result honestly (success/failure with platform).",
  "- In needs_approval mode: explain that the post requires approval in the Marketing → Approvals section. Tell the user exactly where to find it: 'Marketing > Approvals mein ja kar approve karein.'",
  "- NEVER claim success if the publish tool returns an error or 'failed' status. If publishing fails, say honestly that it did not work and explain why (e.g., connection issue, permission missing). Suggest the next step (e.g., check connection in Settings, try again).",
  "- If the publish tool says 'already published', tell the user the post was already published earlier — do NOT attempt to publish again.",
  "- When the user gives a short confirmation like 'haan', 'approve hai', 'post kardo' in the same conversation where a publish was just discussed, treat it as confirmation to proceed with the publish, retaining the post ID from context.",
  "",
  "ALREADY-APPROVED ACTION HANDLING (very important):",
  "- When the user says they already approved a publish action (e.g. 'krdi hay approve ab post kro fb pr', 'approve ho gaya hai, ab publish karo'), FIRST use the find_approval_action tool. If you know the postId, pass it. If you only know the product name (e.g. 'Banarsi Jamawar'), pass productName instead — the tool will search by product name.",
  "- If find_approval_action returns found:true with status 'completed', tell the user the post was already published. Do NOT create a new approval or publish request.",
  "- If find_approval_action returns found:true with status 'approved', use the execute_approved_action tool with the actionId to execute it. Do NOT create a new approval.",
  "- If find_approval_action returns found:true with status 'pending', tell the user the action is still pending approval in Marketing → Approvals.",
  "- If find_approval_action returns found:true with status 'failed', report the real failure reason honestly. Do NOT silently create a duplicate.",
  "- If find_approval_action returns found:true with status 'executing', tell the user the action is currently being processed.",
  "- If find_approval_action returns found:false, then and ONLY then create a new publish request via publish_social_post.",
  "- NEVER create a new approval action when one already exists for the same post. This causes duplicate approvals and confuses the user.",
  "- The approval state in the database is the source of truth — NOT the chat history or the AI's previous message.",
  "- NEVER say 'draft ID missing' or 'post ID nahi mil raha' when the product/action can be resolved from the database using productName.",
  "",
  "PRIVACY & SCOPE:",
  "- The business profile (name, type, currency, language, phone, address) is readable AND editable through your tools, exactly like the app's Settings page. These capabilities DO exist.",
  "- For 'mera business ka naam kya hai?' style questions, read the current profile with a tool instead of relying on memory.",
  "- When asked to change business details (e.g. name, phone, address, currency), perform the update with the settings tool and report the saved result.",
  "",
  "PRIVACY & SCOPE:",
  "- You can only see this business's own data. Never mention other businesses.",
  "- Never reveal internal implementation details such as tool names, function names, API terms, database terms or provider names. Speak in plain business language ('main ne stock update kar diya', not 'tool call succeeded').",
  "- If asked about topics outside this business's management (coding, general chat, news), politely steer back to business work.",
];
const PRE_CHANGE_BASE_HEADER = PRE_CHANGE_BASE[0];
const PRE_CHANGE_BASE_LANGUAGE_RULE = PRE_CHANGE_BASE.slice(5, 10).join("\n");
const PRE_CHANGE_VARIANTS = {
  "clothing_fashion:en": { header: "You are the AI Business Manager for \"Test Shop\" (Clothing / Fashion).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in clear, simple English.\n- Keep sentences short, warm and easy for a non-technical business owner.\n- The user may occasionally write in Roman Urdu; understand it, but still reply in English.\n" },
  "clothing_fashion:ur": { header: "You are the AI Business Manager for \"Test Shop\" (Kapray / Fashion).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in simple, natural Roman Urdu (Urdu written in English letters).\n- Example style: 'Apki aaj ki total sale Rs. 25,000 hai.'\n- Keep sentences short, warm and easy for a non-technical shop owner.\n- The user may mix English words into Roman Urdu — that is fine; still answer in Roman Urdu.\n- Do not use difficult or technical vocabulary.\n" },
  "restaurant_food:en": { header: "You are the AI Business Manager for \"Test Shop\" (Restaurant / Food).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in clear, simple English.\n- Keep sentences short, warm and easy for a non-technical business owner.\n- The user may occasionally write in Roman Urdu; understand it, but still reply in English.\n" },
  "restaurant_food:ur": { header: "You are the AI Business Manager for \"Test Shop\" (Restaurant / Khana).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in simple, natural Roman Urdu (Urdu written in English letters).\n- Example style: 'Apki aaj ki total sale Rs. 25,000 hai.'\n- Keep sentences short, warm and easy for a non-technical shop owner.\n- The user may mix English words into Roman Urdu — that is fine; still answer in Roman Urdu.\n- Do not use difficult or technical vocabulary.\n" },
  "retail_shop:en": { header: "You are the AI Business Manager for \"Test Shop\" (Retail Shop).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in clear, simple English.\n- Keep sentences short, warm and easy for a non-technical business owner.\n- The user may occasionally write in Roman Urdu; understand it, but still reply in English.\n" },
  "retail_shop:ur": { header: "You are the AI Business Manager for \"Test Shop\" (Retail Dukan).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in simple, natural Roman Urdu (Urdu written in English letters).\n- Example style: 'Apki aaj ki total sale Rs. 25,000 hai.'\n- Keep sentences short, warm and easy for a non-technical shop owner.\n- The user may mix English words into Roman Urdu — that is fine; still answer in Roman Urdu.\n- Do not use difficult or technical vocabulary.\n" },
  "grocery:en": { header: "You are the AI Business Manager for \"Test Shop\" (Grocery).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in clear, simple English.\n- Keep sentences short, warm and easy for a non-technical business owner.\n- The user may occasionally write in Roman Urdu; understand it, but still reply in English.\n" },
  "grocery:ur": { header: "You are the AI Business Manager for \"Test Shop\" (Kirana).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in simple, natural Roman Urdu (Urdu written in English letters).\n- Example style: 'Apki aaj ki total sale Rs. 25,000 hai.'\n- Keep sentences short, warm and easy for a non-technical shop owner.\n- The user may mix English words into Roman Urdu — that is fine; still answer in Roman Urdu.\n- Do not use difficult or technical vocabulary.\n" },
  "electronics:en": { header: "You are the AI Business Manager for \"Test Shop\" (Electronics).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in clear, simple English.\n- Keep sentences short, warm and easy for a non-technical business owner.\n- The user may occasionally write in Roman Urdu; understand it, but still reply in English.\n" },
  "electronics:ur": { header: "You are the AI Business Manager for \"Test Shop\" (Electronics).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in simple, natural Roman Urdu (Urdu written in English letters).\n- Example style: 'Apki aaj ki total sale Rs. 25,000 hai.'\n- Keep sentences short, warm and easy for a non-technical shop owner.\n- The user may mix English words into Roman Urdu — that is fine; still answer in Roman Urdu.\n- Do not use difficult or technical vocabulary.\n" },
  "services:en": { header: "You are the AI Business Manager for \"Test Shop\" (Services).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in clear, simple English.\n- Keep sentences short, warm and easy for a non-technical business owner.\n- The user may occasionally write in Roman Urdu; understand it, but still reply in English.\n" },
  "services:ur": { header: "You are the AI Business Manager for \"Test Shop\" (Services).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in simple, natural Roman Urdu (Urdu written in English letters).\n- Example style: 'Apki aaj ki total sale Rs. 25,000 hai.'\n- Keep sentences short, warm and easy for a non-technical shop owner.\n- The user may mix English words into Roman Urdu — that is fine; still answer in Roman Urdu.\n- Do not use difficult or technical vocabulary.\n" },
  "other:en": { header: "You are the AI Business Manager for \"Test Shop\" (Other).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in clear, simple English.\n- Keep sentences short, warm and easy for a non-technical business owner.\n- The user may occasionally write in Roman Urdu; understand it, but still reply in English.\n" },
  "other:ur": { header: "You are the AI Business Manager for \"Test Shop\" (Deegar).", languageRule: "LANGUAGE RULE (very important):\n- Reply ONLY in simple, natural Roman Urdu (Urdu written in English letters).\n- Example style: 'Apki aaj ki total sale Rs. 25,000 hai.'\n- Keep sentences short, warm and easy for a non-technical shop owner.\n- The user may mix English words into Roman Urdu — that is fine; still answer in Roman Urdu.\n- Do not use difficult or technical vocabulary.\n" },
};

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

const LANGUAGES = ["en", "ur"];
const CLOTHING_TYPE = "clothing_fashion";
const NON_CLOTHING_TYPES = BUSINESS_TYPES.filter((t) => t !== CLOTHING_TYPE);
const TODAY_PLACEHOLDER = "{{TODAY}}";
const TODAY = new Date().toISOString().slice(0, 10);
const TEST_CONTEXT = {
  businessId: "business-1",
  businessName: "Test Shop",
  businessType: CLOTHING_TYPE,
  currencyCode: "PKR",
  currencySymbol: "Rs",
  language: "en",
};

/** Real instructions for one combination, with today's date made comparable. */
function instructionsFor(businessType, language) {
  return buildBusinessManagerInstructions({
    ...TEST_CONTEXT,
    businessType,
    language,
  }).split(TODAY).join(TODAY_PLACEHOLDER);
}

/** The stored pre-change instructions for one combination. */
function expectedPreChange(businessType, language) {
  const key = `${businessType}:${language}`;
  const variant = PRE_CHANGE_VARIANTS[key];
  if (!variant) throw new Error(`no pre-change snapshot stored for ${key}`);
  return PRE_CHANGE_BASE.join("\n")
    .replace(PRE_CHANGE_BASE_HEADER, variant.header)
    .replace(PRE_CHANGE_BASE_LANGUAGE_RULE, variant.languageRule);
}

/** First differing line of two texts, for a readable failure detail. */
function firstDifference(a, b) {
  const left = a.split("\n");
  const right = b.split("\n");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) {
      return `line ${i + 1}: expected ${JSON.stringify(right[i])}, got ${JSON.stringify(left[i])}`;
    }
  }
  return "";
}

/** Where the section is spliced in, so nothing else about the text can move. */
const CONFIRMATION_MARKER = "\n\nCONFIRMATION POLICY:";

/* ---------------------------------------------------------------------------
 * 1. The clothing section reaches the prompt, in both languages.
 * ------------------------------------------------------------------------ */

for (const language of LANGUAGES) {
  const section = buildClothingProductInstructions(language);
  const full = instructionsFor(CLOTHING_TYPE, language);
  record(
    `clothing instructions (${language}) contain the clothing section verbatim`,
    full.includes(section),
    section.split("\n")[0],
  );
  record(
    `clothing instructions (${language}) differ from the pre-change text ONLY by that section`,
    full === expectedPreChange(CLOTHING_TYPE, language).replace(
      CONFIRMATION_MARKER,
      `\n\n${section}${CONFIRMATION_MARKER}`,
    ),
    full === expectedPreChange(CLOTHING_TYPE, language).replace(
      CONFIRMATION_MARKER,
      `\n\n${section}${CONFIRMATION_MARKER}`,
    )
      ? ""
      : firstDifference(
          full,
          expectedPreChange(CLOTHING_TYPE, language).replace(
            CONFIRMATION_MARKER,
            `\n\n${section}${CONFIRMATION_MARKER}`,
          ),
        ),
  );
}

record(
  "clothing section is placed in the prompt exactly once",
  (() => {
    const full = instructionsFor(CLOTHING_TYPE, "en");
    const heading = buildClothingProductInstructions("en").split("\n")[0];
    return full.split(heading).length - 1 === 1;
  })(),
);

/* ---------------------------------------------------------------------------
 * 2. Every other business type is byte-identical to the pre-change snapshot.
 * ------------------------------------------------------------------------ */

for (const businessType of NON_CLOTHING_TYPES) {
  for (const language of LANGUAGES) {
    const actual = instructionsFor(businessType, language);
    const expected = expectedPreChange(businessType, language);
    record(
      `${businessType} (${language}) instructions are byte-identical to the pre-change snapshot`,
      actual === expected,
      actual === expected ? "" : firstDifference(actual, expected),
    );
    record(
      `${businessType} (${language}) instructions contain no clothing section`,
      !actual.includes(buildClothingProductInstructions(language).split("\n")[0]),
    );
  }
}

// An unknown type falls back to "other" rules (lib/business/type-config.ts), so
// it must be treated as a non-clothing business too.
for (const language of LANGUAGES) {
  const actual = buildBusinessManagerInstructions({
    ...TEST_CONTEXT,
    businessType: "not_a_real_business_type",
    language,
  })
    .split(TODAY)
    .join(TODAY_PLACEHOLDER);
  record(
    `an unknown business type (${language}) gets no clothing section`,
    !actual.includes(buildClothingProductInstructions(language).split("\n")[0]),
  );
}

/* ---------------------------------------------------------------------------
 * 3. The option lists in the text are the ones in the code.
 * ------------------------------------------------------------------------ */

for (const language of LANGUAGES) {
  const section = buildClothingProductInstructions(language);

  for (const key of CLOTHING_ATTRIBUTE_KEYS) {
    const expectedLine = `- ${key} options: ${CLOTHING_ATTRIBUTE_OPTIONS[key].join(", ")}`;
    record(
      `${language}: ${key} option list is exactly the ${CLOTHING_ATTRIBUTE_OPTIONS[key].length} values in lib/business/product-attributes.ts`,
      section.includes(expectedLine),
      section.includes(expectedLine)
        ? ""
        : `missing line ${JSON.stringify(expectedLine)}`,
    );
  }

  const expectedUnitLine = `- unit options: ${UNIT_OPTIONS.join(", ")}`;
  record(
    `${language}: unit option list is exactly the ${UNIT_OPTIONS.length} values in lib/business/product-units.ts`,
    section.includes(expectedUnitLine),
    section.includes(expectedUnitLine)
      ? ""
      : `missing line ${JSON.stringify(expectedUnitLine)}`,
  );

  const missingValues = [
    ...CLOTHING_ATTRIBUTE_KEYS.flatMap((key) => CLOTHING_ATTRIBUTE_OPTIONS[key]),
    ...UNIT_OPTIONS,
  ].filter((option) => !section.includes(option));
  record(
    `${language}: every predefined option value appears in the section`,
    missingValues.length === 0,
    missingValues.length === 0 ? "" : `missing ${JSON.stringify(missingValues)}`,
  );

  record(
    `${language}: the section says custom values are allowed`,
    /custom value/i.test(section),
  );
}

/* ---------------------------------------------------------------------------
 * 4. The section stays short — it is appended to an already long prompt.
 * ------------------------------------------------------------------------ */

for (const language of LANGUAGES) {
  const lineCount = buildClothingProductInstructions(language).split("\n").length;
  record(
    `${language}: clothing section is within the ${CLOTHING_SECTION_LINE_BUDGET} line budget`,
    lineCount <= CLOTHING_SECTION_LINE_BUDGET,
    `${lineCount} lines`,
  );
}

/* ---------------------------------------------------------------------------
 * 5. Every parameter the section names is a REAL tool parameter.
 * ------------------------------------------------------------------------ */

/** The tool parameters Prompt 2 introduced, in the order the section lists them. */
const CLOTHING_TOOL_PARAMETERS = [
  ...CLOTHING_ATTRIBUTE_KEYS,
  "unit",
  "cost_price",
  "clear_attributes",
];

const createProperties = Object.keys(
  createProductTool.parameters.properties ?? {},
);
const updateProperties = Object.keys(
  updateProductTool.parameters.properties ?? {},
);

for (const language of LANGUAGES) {
  const section = buildClothingProductInstructions(language);
  const unmentioned = CLOTHING_TOOL_PARAMETERS.filter(
    (name) => !section.includes(name),
  );
  record(
    `${language}: section names every new tool parameter (${CLOTHING_TOOL_PARAMETERS.join(", ")})`,
    unmentioned.length === 0,
    unmentioned.length === 0 ? "" : `not mentioned: ${JSON.stringify(unmentioned)}`,
  );

  const notOnCreate = CLOTHING_TOOL_PARAMETERS.filter(
    (name) => name !== "clear_attributes" && !createProperties.includes(name),
  );
  record(
    `${language}: every parameter the section names exists on create_product`,
    notOnCreate.length === 0,
    notOnCreate.length === 0 ? "" : `missing on create_product: ${JSON.stringify(notOnCreate)}`,
  );

  const notOnUpdate = CLOTHING_TOOL_PARAMETERS.filter(
    (name) => !updateProperties.includes(name),
  );
  record(
    `${language}: every parameter the section names exists on update_product`,
    notOnUpdate.length === 0,
    notOnUpdate.length === 0 ? "" : `missing on update_product: ${JSON.stringify(notOnUpdate)}`,
  );

  // clear_attributes is an optional nullable array, so its enum sits inside the
  // first anyOf branch rather than directly on the property.
  const clearSchema = updateProductTool.parameters.properties.clear_attributes;
  const clearEnum = (clearSchema?.anyOf ?? []).find(
    (branch) => Array.isArray(branch?.items?.enum),
  )?.items?.enum;
  record(
    `${language}: clear_attributes only accepts the real attribute keys`,
    JSON.stringify(clearEnum) === JSON.stringify([...CLOTHING_ATTRIBUTE_KEYS]),
    JSON.stringify(clearEnum),
  );
}

/* ---------------------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------------------ */
const failed = results.filter((r) => !r.passed);
console.log("\n===== SUMMARY =====");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;