import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import { findById, limitSchema, optionalText, orKeep, readAgentContext, resolveProduct, toolClarify, toolFail, toolNeedsConfirmation, toolOk } from "@/lib/ai/tools/shared";
import { recordAgentAudit } from "@/lib/audit/write-audit-log";
import {
  CLOTHING_ATTRIBUTE_KEYS,
  readableProductAttributes,
  type ClothingAttributeKey,
  type ProductAttributes,
} from "@/lib/business/product-attributes";
import {
  createProduct,
  deleteProduct,
  getProducts,
  updateStock,
  adjustProductStock,
  updateProduct,
} from "@/lib/products/service";
import { createDraftForProduct } from "@/lib/marketing/social-posts";
import type { Product } from "@/lib/products/types";
import type { AgentRunContext } from "@/lib/ai/context";

/**
 * Product & inventory tools — controlled wrappers over the product service.
 * All of them run server-side inside the authenticated request scope and can
 * only ever touch the caller's own business data (service + RLS enforce it).
 */

/**
 * The business type of the run context the SDK handed this tool. Every tool runs
 * inside the authenticated request, so this is server-derived and never model
 * input; `undefined` only means a caller invoked the tool outside a run.
 */
function runBusinessType(ctx: unknown): unknown {
  return (ctx as { context?: AgentRunContext } | undefined)?.context?.businessType;
}

/**
 * Shared read shape for every product the agent sees. It carries the unit, the
 * clothing attributes and the cost price so the model can STATE them truthfully
 * ("50 Meter", "cotton, black, embroidered", "cost price 900") instead of
 * guessing or leaving them out. `stock_with_unit` is that same quantity with
 * the stored label attached — the unit is a label only; quantities stay whole
 * numbers and nothing here does arithmetic on them.
 *
 * Attributes are shown only to a business type that HAS the `fabric_attributes`
 * capability (docs/p4.txt Part A). A grocery product that still carries cotton
 * and black from when the shop sold clothes would otherwise hand the model a
 * vocabulary this business cannot use — the stored row keeps the values, the
 * model just never sees them. Without a known business type the already-gated
 * bag from the product service is passed through unchanged, which can only ever
 * hide less, never more. `unit` and `cost_price` are never gated.
 */
function productSummary(product: Product, businessType?: unknown) {
  const attributes =
    businessType === undefined
      ? product.attributes ?? {}
      : readableProductAttributes(businessType, product.attributes);
  const unit = product.unit;
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    stock: product.stockQuantity,
    unit,
    stock_with_unit: `${product.stockQuantity} ${unit}`,
    lowStockThreshold: product.lowStockThreshold,
    sku: product.sku ?? null,
    description: product.description ?? null,
    imageUrl: product.imageUrl ?? null,
    attributes,
    cost_price: product.costPrice,
  };
}

/**
 * Turns the five flat clothing attribute parameters into the one attributes
 * object the service stores. Returns undefined when the model supplied none of
 * them, which is what keeps an update from rewriting the stored attributes.
 * Blank values are passed through as-is and dropped by the server-side
 * validator; nothing is invented here.
 */
function collectAttributePatch(
  params: Partial<Record<ClothingAttributeKey, string | null | undefined>>,
): ProductAttributes | undefined {
  const attributes: ProductAttributes = {};
  for (const key of CLOTHING_ATTRIBUTE_KEYS) {
    const value = params[key];
    if (typeof value === "string") attributes[key] = value;
  }
  return Object.keys(attributes).length > 0 ? attributes : undefined;
}

/**
 * One attribute parameter, shared by create_product and update_product.
 *
 * Deliberately permissive: the real rules (known keys, length, business-type
 * capability) are enforced SERVER-SIDE by lib/business/product-attributes.ts and
 * reported back as a readable message the model can pass on to the owner. A
 * schema-level rejection here would surface as an opaque tool error instead.
 */
const attributeParam = (key: ClothingAttributeKey) =>
  z
    .string()
    .trim()
    .optional()
    .nullable()
    .describe(
      `Clothing attribute "${key}". Only include it when the user actually said a value for it. Custom values are always allowed (e.g. fabric "Chikankari"), but NEVER guess, never guess a colour or size the user did not mention — leave the parameter out instead.`,
    );

/**
 * The one stock rule every quantity parameter has to state, kept as a single
 * string so the four descriptions can never drift apart (docs/p6.txt — Part A).
 *
 * Quantities are stored as whole numbers, so "2.5 kg" cannot be recorded. The
 * honest behaviour is to say so and ask for a whole number — a silent round to 3
 * would invent a stock figure the owner never stated, and a rejected tool call
 * teaches the model nothing about WHY. It belongs in the parameter description
 * because that is the only text the model reads for the number it is about to
 * send, and it must be there for a grocery shop asking in kilos exactly as it is
 * for a clothing shop asking in pieces.
 *
 * Offline check: tests/ai/business-tools.mjs fails if this sentence is dropped
 * from any of newStock, delta, stockQuantity or unit.
 */
const WHOLE_NUMBER_RULE =
  "Whole numbers only. If the user asks for a fractional amount (e.g. 2.5 kg), do NOT round it; tell the user fractional quantities are not supported yet and ask for a whole number.";

const unitParam = z
  .string()
  .trim()
  .optional()
  .nullable()
  .describe(
    `Unit label for this product, shown next to the quantity (e.g. stock "50 Meter"). Common labels: Piece, Meter, Yard, Set, Dozen; a custom label is allowed too. The unit is only a label — quantities stay whole numbers. Include it ONLY when the user stated a unit; otherwise leave it out. ${WHOLE_NUMBER_RULE}`,
  );

const costPriceParam = z
  .number()
  .optional()
  .nullable()
  .describe(
    "Price the business PAID for one unit of this product (used later for profit reporting), in the business currency. Must be 0 or more. Include it ONLY when the user gave a real cost price — never invent or guess one, and leave it out when the user did not say.",
  );

async function loadProducts(): Promise<Product[] | null> {
  const result = await getProducts();
  return result.ok ? result.data : null;
}

/**
 * Product fields worth keeping in change history, each mapped to the snapshot
 * key it is stored under. Stock is deliberately absent: update_product never
 * writes stock (it has dedicated tools) and stock history is already recorded
 * by stock.set / stock.adjust. The unit label and the cost price ARE recorded:
 * both are commercial facts a later profit report depends on.
 */
const PRODUCT_AUDIT_FIELDS: ReadonlyArray<[keyof Product, string]> = [
  ["name", "name"],
  ["category", "category"],
  ["price", "price"],
  ["sku", "sku"],
  ["description", "description"],
  ["lowStockThreshold", "low_stock_threshold"],
  ["imageUrl", "image_url"],
  ["unit", "unit"],
  ["costPrice", "cost_price"],
];

/**
 * Builds the before/after pair for a product edit from ONLY the fields the save
 * actually changed, so history never becomes a copy of the whole record.
 * Returns null when nothing changed, which keeps a no-op update out of the log.
 *
 * Attributes are diffed KEY BY KEY and recorded as `attributes.<key>`, so a
 * single changed colour does not copy the whole bag into the row, and a removed
 * key is visible as a null on the "after" side. These are ordinary commercial
 * facts (fabric, colour, design), not personal data.
 */
function productChangeAudit(
  previous: Product,
  next: Product,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [field, key] of PRODUCT_AUDIT_FIELDS) {
    const oldValue = previous[field] ?? null;
    const newValue = next[field] ?? null;
    if (oldValue === newValue) continue;
    before[key] = oldValue;
    after[key] = newValue;
  }

  const previousAttributes = previous.attributes ?? {};
  const nextAttributes = next.attributes ?? {};
  const attributeKeys = new Set([
    ...Object.keys(previousAttributes),
    ...Object.keys(nextAttributes),
  ]);
  for (const key of attributeKeys) {
    const oldValue = previousAttributes[key] ?? null;
    const newValue = nextAttributes[key] ?? null;
    if (oldValue === newValue) continue;
    before[`attributes.${key}`] = oldValue;
    after[`attributes.${key}`] = newValue;
  }

  return Object.keys(after).length > 0 ? { before, after } : null;
}

/**
 * Resolves a product from either an explicit ID (preferred — bypasses the
 * ambiguous name search) or a name query. The ID path is what lets the agent
 * act on a specific candidate it listed earlier (e.g. "pehla wala") instead of
 * re-running a name search that hits the same ambiguity.
 */
async function resolveProductTarget(
  products: Product[],
  params: { productId?: string | null; query?: string },
): Promise<ReturnType<typeof resolveProduct>> {
  if (params.productId) {
    const byId = findById(products, params.productId);
    console.log(
      "[disambiguation] resolveProductTarget used ID path productId=",
      JSON.stringify(params.productId),
      "=>",
      byId ? `FOUND (${byId.name})` : "NOT_FOUND",
    );
    return byId ? { kind: "found", item: byId } : { kind: "not_found" };
  }
  const result = resolveProduct(params.query ?? "", products);
  console.log(
    "[disambiguation] resolveProductTarget used NAME path query=",
    JSON.stringify(params.query ?? ""),
    "=>",
    result.kind,
    result.kind === "ambiguous" ? `(${result.candidates.length} candidates)` : "",
  );
  return result;
}

export const listProductsTool = tool({
  name: "list_products",
  description:
    "List the business's active products with price and stock. Optional search matches name, SKU or category. Use for questions like 'which products do I have' or 'stock mein kya hai'. Each item carries its unit label (report a quantity as e.g. '50 Meter'), its clothing attributes and its cost price when one is set — quote them only from the result, never from memory.",
  parameters: z.object({
    search: z.string().trim().max(120).optional().nullable(),
    limit: limitSchema(20, 50),
  }),
  execute: async ({ search, limit }, ctx) => {
    const result = await getProducts(
      search ? { search } : {},
    );
    if (!result.ok) {
      return toolFail(result.reason, "Could not read products. Ask the user to try again.");
    }
    const businessType = runBusinessType(ctx);
    const products = result.data;
    return toolOk({
      count: products.length,
      truncated: products.length > limit,
      products: products.slice(0, limit).map((product) => productSummary(product, businessType)),
    });
  },
});

export const findProductTool = tool({
  name: "find_product",
  description:
    "Find ONE specific product by its name (or SKU), e.g. 'Blue Suit'. Returns full details including current stock with its unit label, clothing attributes and cost price when set — quote them exactly as returned. Prefer this over list_products when the user names a specific item. When you have previously listed ambiguous candidates, you may pass productId to target the exact one the user picked.",
  parameters: z.object({
    query: z.string().trim().min(1).max(160).optional().nullable(),
    productId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact product ID from a previous tool result (e.g. when the user picked 'pehla'/'first' from a candidate list). Bypasses name search."),
  }),
  execute: async ({ query, productId }, ctx) => {
    const products = await loadProducts();
    if (!products) {
      return toolFail("database_error", "Could not read products. Ask the user to try again.");
    }
    const businessType = runBusinessType(ctx);
    const match = await resolveProductTarget(products, { productId, query: query ?? undefined });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such product. Tell the user honestly and offer to add it.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map((product) => productSummary(product, businessType)),
        hint: "Several products match. Ask the user which one they mean.",
      });
    }
    return toolOk({ product: productSummary(match.item, businessType) });
  },
});

export const lowStockTool = tool({
  name: "low_stock_products",
  description:
    "List active products that are low on stock or out of stock, most critical first. Answers 'kon se products ka stock kam hai?' / 'show low stock items'. Each item carries its unit label, so report the quantity as e.g. '3 Meter' or '50 Piece'.",
  parameters: z.object({}),
  execute: async (_params, ctx) => {
    const result = await getProducts();
    if (!result.ok) {
      return toolFail(result.reason, "Could not read inventory. Ask the user to try again.");
    }
    const businessType = runBusinessType(ctx);
    const low = result.data
      .filter((p) => p.stockQuantity <= p.lowStockThreshold || p.stockQuantity <= 0)
      .sort((a, b) => a.stockQuantity - b.stockQuantity)
      .map((p) => ({
        ...productSummary(p, businessType),
        out_of_stock: p.stockQuantity <= 0,
      }));
    return toolOk({ count: low.length, products: low });
  },
});

export const createProductTool = tool({
  name: "create_product",
  description:
    "Add a new product to the catalog. Requires at least a name, a category and a price. If details are missing, ask the user for them first — never invent prices, categories, attributes, units or cost prices. Optional clothing attributes (product_type, fabric, color, design, size) accept the common values AND any custom value the owner uses; pass one ONLY when the user actually said it. The unit is a label ('50 Meter'), never a fractional quantity. If an image was attached by the user, ALWAYS include the imageUrl parameter with the URL from the attached image.",
  parameters: z.object({
    name: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(60),
    price: z.number().min(0),
    stockQuantity: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe(
        `The quantity of this product the business has right now (e.g. 'stock 50 hai' → 50). ${WHOLE_NUMBER_RULE}`,
      ),
    lowStockThreshold: z.number().int().min(0).optional().default(5),
    description: z.string().trim().max(500).optional().nullable(),
    imageUrl: z.string().trim().max(2000).optional().nullable().describe("Image URL for the product. Must be a valid URL string. ALWAYS include this when the user has attached an image."),
    product_type: attributeParam("product_type"),
    fabric: attributeParam("fabric"),
    color: attributeParam("color"),
    design: attributeParam("design"),
    size: attributeParam("size"),
    unit: unitParam,
    cost_price: costPriceParam,
  }),
  execute: async (input, ctx) => {
    // Provider-robust image URL fix: if the model omitted imageUrl but the
    // user attached an image this turn, merge it server-side so image
    // attachment works regardless of which provider/model is active.
    const turnImageUrl = (ctx?.context as AgentRunContext | undefined)?.imageUrl;
    const { product_type, fabric, color, design, size, unit, cost_price, ...rest } = input;
    const merged = {
      ...rest,
      imageUrl: input.imageUrl ?? turnImageUrl ?? undefined,
      attributes: collectAttributePatch({ product_type, fabric, color, design, size }),
      unit,
      costPrice: cost_price ?? undefined,
    };

    console.log("[product-tools] createProduct input:", JSON.stringify(merged, null, 2));

    const result = await createProduct(merged);
    if (!result.ok) {
      return toolFail(
        result.reason,
        result.reason === "invalid_input"
          ? `Invalid product details. ${result.detail ?? ""} Check name/category/price values and correct them.`.trim()
          : "Could not create the product. Tell the user it failed; do not pretend success.",
      );
    }

    // History for the change the backend just confirmed (docs/1c.txt). A
    // creation has no prior state, so `before` stays null and the snapshot is
    // the commercial summary only — now including the unit, the attributes and
    // the cost price, which are exactly the values a later profit report needs.
    await recordAgentAudit(readAgentContext(ctx), {
      action: "product.create",
      entity: "product",
      entityId: result.data.id,
      after: {
        name: result.data.name,
        sku: result.data.sku,
        category: result.data.category,
        price: result.data.price,
        stock_quantity: result.data.stockQuantity,
        unit: result.data.unit,
        attributes: result.data.attributes,
        cost_price: result.data.costPrice,
      },
    });

    // Marketing hook (Phase 2, reduced — same behaviour as createProductAction):
    // once a product exists, trigger the controlled service that generates a
    // REAL AI caption and saves it as a "draft" social post in the business's
    // marketing activity. This is best-effort — a caption-generation/provider
    // failure must never block or break product creation, so we await then
    // swallow the outcome. The draft is written through the same service the
    // dedicated marketing tool uses.
    try {
      await createDraftForProduct(result.data);
      console.log("[product-tools] draft post created for new product:", result.data.id);
    } catch (error) {
      console.error(
        "[product-tools] draft post generation failed after product creation:",
        error instanceof Error ? error.message : String(error),
      );
    }

    return toolOk({
      created: true,
      product: productSummary(result.data, runBusinessType(ctx)),
    });
  },
});

export const updateProductTool = tool({
  name: "update_product",
  description:
    "Update an existing product's details: name, category, price, description, SKU, low-stock threshold, image, clothing attributes (product_type, fabric, color, design, size), unit label or cost price. Only include the fields that should change; everything else stays as it is. Attributes MERGE: sending one attribute changes only that key and never clears the others — to remove an attribute, pass its name in clear_attributes. To remove a saved cost price, pass clear_cost_price: true, and ONLY when the user explicitly asked for that; never send it together with cost_price. Custom attribute values are always allowed, but never guess one the user did not say. The unit is a label ('50 Meter'), never a fractional quantity. For stock changes use set_product_stock / adjust_product_stock instead. If an image was attached by the user, ALWAYS include the imageUrl parameter with the URL from the attached image.",
  parameters: z.object({
    productName: z.string().trim().min(1).max(160).optional().nullable(),
    productId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact product ID from a previous tool result when the user picked a specific candidate. Bypasses name search."),
    name: z.string().trim().min(1).max(120).optional().nullable(),
    category: z.string().trim().min(1).max(60).optional().nullable(),
    price: z.number().min(0).optional().nullable(),
    description: optionalText(500),
    sku: optionalText(60),
    lowStockThreshold: z.number().int().min(0).optional().nullable(),
    imageUrl: z.string().trim().max(2000).optional().nullable().describe("Image URL for the product. Must be a valid URL string. ALWAYS include this when the user has attached an image."),
    product_type: attributeParam("product_type"),
    fabric: attributeParam("fabric"),
    color: attributeParam("color"),
    design: attributeParam("design"),
    size: attributeParam("size"),
    unit: unitParam,
    cost_price: costPriceParam,
    clear_attributes: z
      .array(z.enum([...CLOTHING_ATTRIBUTE_KEYS]))
      .max(CLOTHING_ATTRIBUTE_KEYS.length)
      .optional()
      .nullable()
      .describe(
        "Attribute keys to REMOVE from this product (product_type, fabric, color, design, size). Only use this when the user actually asked to remove an attribute — every other key is kept.",
      ),
    clear_cost_price: z
      .boolean()
      .optional()
      .nullable()
      .describe(
        "Set to true ONLY when the user explicitly asked to remove, delete or reset this product's cost price (e.g. 'cost price hata do'). It erases the saved cost price. Leave it out in every other case — a missing cost price is never a reason to erase one, and never send it together with cost_price.",
      ),
  }),
  execute: async (
    {
      productName,
      productId,
      product_type,
      fabric,
      color,
      design,
      size,
      unit,
      cost_price,
      clear_attributes,
      clear_cost_price,
      ...changes
    },
    ctx,
  ) => {
    // Provider-robust image URL fix: if the model omitted imageUrl but the
    // user attached an image this turn, merge it server-side.
    const turnImageUrl = (ctx?.context as AgentRunContext | undefined)?.imageUrl;
    const mergedChanges = {
      ...changes,
      imageUrl: changes.imageUrl ?? turnImageUrl ?? undefined,
    };

    const products = await loadProducts();
    if (!products) {
      return toolFail("database_error", "Could not read products. Ask the user to try again.");
    }
    const match = await resolveProductTarget(products, { productId, query: productName ?? undefined });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such product. Tell the user honestly.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(productSummary),
        hint: "Ask the user which product they mean.",
      });
    }

    // Merge onto the stored record so unspecified fields are preserved. The
    // model often sends `null` for fields it isn't changing; orKeep treats null
    // as "leave unchanged" so updating one field never wipes the others.
    const current = match.item;
    // "Save this cost" and "delete the saved cost" in one call cannot both be
    // what the user meant, so neither is executed — the model is told to ask.
    if (clear_cost_price === true && cost_price !== undefined && cost_price !== null) {
      return toolFail(
        "invalid_input",
        "The request asks to both set a new cost price and remove the current one. Ask the user which one they mean, then do only that.",
      );
    }
    const attributePatch = collectAttributePatch({ product_type, fabric, color, design, size });
    const merged: Record<string, unknown> = {
      name: mergedChanges.name ?? current.name,
      category: mergedChanges.category ?? current.category,
      price: mergedChanges.price ?? current.price,
      description: orKeep(mergedChanges.description, current.description),
      sku: orKeep(mergedChanges.sku, current.sku),
      lowStockThreshold: mergedChanges.lowStockThreshold ?? current.lowStockThreshold,
      stockQuantity: current.stockQuantity,
      imageUrl: orKeep(mergedChanges.imageUrl, current.imageUrl),
      unit: unit ?? current.unit,
    };
    // The cost price has three honest cases, and only one of them changes it:
    // a stated amount replaces it, clear_cost_price erases it, and anything else
    // leaves the stored value exactly as it is. A missing cost_price is never
    // read as "reset to 0" and never as "delete it".
    if (clear_cost_price === true) {
      merged.clearCostPrice = true;
    } else if (cost_price !== undefined && cost_price !== null) {
      merged.costPrice = cost_price;
    } else if (current.costPrice !== null) {
      merged.costPrice = current.costPrice;
    }
    // Attributes are a PATCH: only sent when the model supplied one, so the
    // service merges it into the stored bag instead of replacing it. Removal is
    // always explicit, through clear_attributes.
    if (attributePatch) merged.attributes = attributePatch;
    if (clear_attributes && clear_attributes.length > 0) {
      merged.clearAttributes = clear_attributes;
    }

    console.log("[product-tools] updateProduct merged input:", JSON.stringify({ productName, ...merged }, null, 2));

    const result = await updateProduct(current.id, merged, { skipStock: true });
    if (!result.ok) {
      return toolFail(
        result.reason,
        result.reason === "invalid_input"
          ? `Invalid product details. ${result.detail ?? ""} Check the values and correct them.`.trim()
          : result.reason === "sku_conflict"
            ? "That SKU is already used by another product. Ask for a different SKU."
            : "Product update failed. Do not claim success.",
      );
    }
    // Only the fields the save actually changed are recorded; an edit that
    // changed nothing writes no row at all (docs/1c.txt).
    const changed = productChangeAudit(current, result.data);
    if (changed) {
      await recordAgentAudit(readAgentContext(ctx), {
        action: "product.update",
        entity: "product",
        entityId: current.id,
        before: changed.before,
        after: changed.after,
      });
    }
    return toolOk({
      updated: true,
      product: productSummary(result.data, runBusinessType(ctx)),
    });
  },
});

export const setProductStockTool = tool({
  name: "set_product_stock",
  description:
    "Set a product's stock to an exact total quantity, e.g. 'Black Kurta ka stock 50 kar do' → set_product_stock(productName:'Black Kurta', newStock:50). This REPLACES the stored quantity. When the user picked a specific candidate from a list, pass productId to target it exactly.",
  parameters: z.object({
    productName: z.string().trim().min(1).max(160).optional().nullable(),
    productId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact product ID from a previous tool result when the user picked a specific candidate. Bypasses name search."),
    newStock: z
      .number()
      .int()
      .min(0)
      .describe(
        `The product's NEW total stock quantity, which replaces whatever is stored now (e.g. 'Black Kurta ka stock 50 kar do' → 50). ${WHOLE_NUMBER_RULE}`,
      ),
  }),
  execute: async ({ productName, productId, newStock }, ctx) => {
    const products = await loadProducts();
    if (!products) {
      return toolFail("database_error", "Could not read products. Ask the user to try again.");
    }
    const match = await resolveProductTarget(products, { productId, query: productName ?? undefined });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such product. Tell the user honestly.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(productSummary),
        hint: "Ask the user which product they mean.",
      });
    }
    const target = match.item;
    const result = await updateStock(target.id, newStock);
    if (!result.ok) {
      return toolFail(result.reason, "Stock update failed. Do not claim success.");
    }
    // History for the change the backend just confirmed (docs/1b.txt). Only the
    // quantity — never the whole product row.
    await recordAgentAudit(readAgentContext(ctx), {
      action: "stock.set",
      entity: "product",
      entityId: target.id,
      before: { stock_quantity: target.stockQuantity },
      after: { stock_quantity: result.data.stockQuantity },
    });
    return toolOk({
      updated: true,
      previous_stock: target.stockQuantity,
      product: productSummary(result.data, runBusinessType(ctx)),
    });
  },
});

export const adjustProductStockTool = tool({
  name: "adjust_product_stock",
  description:
    "Increase or decrease a product's stock by a delta, e.g. '+10 arrived' or '-3 sold/damaged'. Use when the user describes a change rather than a final quantity. When the user picked a specific candidate from a list, pass productId to target it exactly.",
  parameters: z.object({
    productName: z.string().trim().min(1).max(160).optional().nullable(),
    productId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact product ID from a previous tool result when the user picked a specific candidate. Bypasses name search."),
    delta: z
      .number()
      .int()
      .describe(
        `The change to apply to the current stock: a positive number adds (e.g. '+10 aaye'), a negative number removes (e.g. '-3 bik gaye' or '-3 damaged'). ${WHOLE_NUMBER_RULE}`,
      ),
  }),
  execute: async ({ productName, productId, delta }, ctx) => {
    const products = await loadProducts();
    if (!products) {
      return toolFail("database_error", "Could not read products. Ask the user to try again.");
    }
    const match = await resolveProductTarget(products, { productId, query: productName ?? undefined });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such product. Tell the user honestly.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(productSummary),
        hint: "Ask the user which product they mean.",
      });
    }
    const target = match.item;
    const result = await adjustProductStock(target.id, delta);
    if (!result.ok) {
      return toolFail(
        result.reason,
        result.reason === "insufficient_stock"
          ? "Not enough stock to remove that much. Explain the current stock instead."
          : "Stock change failed. Do not claim success.",
      );
    }
    await recordAgentAudit(readAgentContext(ctx), {
      action: "stock.adjust",
      entity: "product",
      entityId: target.id,
      before: { stock_quantity: target.stockQuantity },
      after: { stock_quantity: result.data.stockQuantity },
    });
    return toolOk({
      updated: true,
      delta,
      product: productSummary(result.data, runBusinessType(ctx)),
    });
  },
});

export const deleteProductTool = tool({
  name: "delete_product",
  description:
    "Remove a product from the active catalog (archived, history is preserved). DESTRUCTIVE: requires the user's explicit confirmation in a previous turn before confirmed=true may be used. When the user picked a specific candidate from an earlier list, pass productId to delete exactly that one; otherwise pass the productName.",
  parameters: z.object({
    productName: z.string().trim().min(1).max(160).optional().nullable(),
    productId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact product ID from a previous tool result when the user picked a specific candidate. Bypasses name search."),
    confirmed: z.boolean().default(false),
  }),
  execute: async ({ productName, productId, confirmed }, ctx) => {
    const products = await loadProducts();
    if (!products) {
      return toolFail("database_error", "Could not read products. Ask the user to try again.");
    }
    const match = await resolveProductTarget(products, { productId, query: productName ?? undefined });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such product. Tell the user honestly.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(productSummary),
        hint: "Ask the user which product they mean.",
      });
    }
    const target = match.item;
    if (!confirmed) {
      return toolNeedsConfirmation(
        `Delete "${target.name}" (${target.category}, stock ${target.stockQuantity} ${target.unit})`,
        `Kya aap sach mein "${target.name}" ko hataana chahte hain?`,
        `Kya aap sach mein "${target.name}" ko hataana chahte hain?`,
      );
    }
    const result = await deleteProduct(target.id);
    if (!result.ok) {
      return toolFail(result.reason, "Deletion failed. Do not claim success.");
    }
    // The archive no longer returns the row, so the "before" state is captured
    // from what was resolved above — enough to identify the record, nothing
    // personal (docs/1b.txt).
    await recordAgentAudit(readAgentContext(ctx), {
      action: "product.delete",
      entity: "product",
      entityId: target.id,
      before: {
        name: target.name,
        sku: target.sku,
        category: target.category,
        price: target.price,
        stock: target.stockQuantity,
      },
    });
    return toolOk({ removed: true, name: target.name });
  },
});
