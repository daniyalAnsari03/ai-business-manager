import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import { findById, limitSchema, optionalText, orKeep, resolveProduct, toolClarify, toolFail, toolNeedsConfirmation, toolOk } from "@/lib/ai/tools/shared";
import {
  createProduct,
  deleteProduct,
  getProducts,
  updateStock,
  adjustProductStock,
  updateProduct,
} from "@/lib/products/service";
import type { Product } from "@/lib/products/types";
import type { AgentRunContext } from "@/lib/ai/context";

/**
 * Product & inventory tools — controlled wrappers over the product service.
 * All of them run server-side inside the authenticated request scope and can
 * only ever touch the caller's own business data (service + RLS enforce it).
 */

function productSummary(product: Product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    stock: product.stockQuantity,
    lowStockThreshold: product.lowStockThreshold,
    sku: product.sku ?? null,
    description: product.description ?? null,
    imageUrl: product.imageUrl ?? null,
  };
}

async function loadProducts(): Promise<Product[] | null> {
  const result = await getProducts();
  return result.ok ? result.data : null;
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
    "List the business's active products with price and stock. Optional search matches name, SKU or category. Use for questions like 'which products do I have' or 'stock mein kya hai'.",
  parameters: z.object({
    search: z.string().trim().max(120).optional().nullable(),
    limit: limitSchema(20, 50),
  }),
  execute: async ({ search, limit }) => {
    const result = await getProducts(
      search ? { search } : {},
    );
    if (!result.ok) {
      return toolFail(result.reason, "Could not read products. Ask the user to try again.");
    }
    const products = result.data;
    return toolOk({
      count: products.length,
      truncated: products.length > limit,
      products: products.slice(0, limit).map(productSummary),
    });
  },
});

export const findProductTool = tool({
  name: "find_product",
  description:
    "Find ONE specific product by its name (or SKU), e.g. 'Blue Suit'. Returns full details including current stock. Prefer this over list_products when the user names a specific item. When you have previously listed ambiguous candidates, you may pass productId to target the exact one the user picked.",
  parameters: z.object({
    query: z.string().trim().min(1).max(160).optional().nullable(),
    productId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact product ID from a previous tool result (e.g. when the user picked 'pehla'/'first' from a candidate list). Bypasses name search."),
  }),
  execute: async ({ query, productId }) => {
    const products = await loadProducts();
    if (!products) {
      return toolFail("database_error", "Could not read products. Ask the user to try again.");
    }
    const match = await resolveProductTarget(products, { productId, query: query ?? undefined });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such product. Tell the user honestly and offer to add it.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(productSummary),
        hint: "Several products match. Ask the user which one they mean.",
      });
    }
    return toolOk({ product: productSummary(match.item) });
  },
});

export const lowStockTool = tool({
  name: "low_stock_products",
  description:
    "List active products that are low on stock or out of stock, most critical first. Answers 'kon se products ka stock kam hai?' / 'show low stock items'.",
  parameters: z.object({}),
  execute: async () => {
    const result = await getProducts();
    if (!result.ok) {
      return toolFail(result.reason, "Could not read inventory. Ask the user to try again.");
    }
    const low = result.data
      .filter((p) => p.stockQuantity <= p.lowStockThreshold || p.stockQuantity <= 0)
      .sort((a, b) => a.stockQuantity - b.stockQuantity)
      .map((p) => ({
        ...productSummary(p),
        out_of_stock: p.stockQuantity <= 0,
      }));
    return toolOk({ count: low.length, products: low });
  },
});

export const createProductTool = tool({
  name: "create_product",
  description:
    "Add a new product to the catalog. Requires at least a name, a category and a price. If details are missing, ask the user for them first — never invent prices or categories. If an image was attached by the user, ALWAYS include the imageUrl parameter with the URL from the attached image.",
  parameters: z.object({
    name: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(60),
    price: z.number().min(0),
    stockQuantity: z.number().int().min(0).optional().default(0),
    lowStockThreshold: z.number().int().min(0).optional().default(5),
    description: z.string().trim().max(500).optional().nullable(),
    imageUrl: z.string().trim().max(2000).optional().nullable().describe("Image URL for the product. Must be a valid URL string. ALWAYS include this when the user has attached an image."),
  }),
  execute: async (input, ctx) => {
    // Provider-robust image URL fix: if the model omitted imageUrl but the
    // user attached an image this turn, merge it server-side so image
    // attachment works regardless of which provider/model is active.
    const turnImageUrl = (ctx?.context as AgentRunContext | undefined)?.imageUrl;
    const merged = {
      ...input,
      imageUrl: input.imageUrl ?? turnImageUrl ?? undefined,
    };

    console.log("[product-tools] createProduct input:", JSON.stringify(merged, null, 2));

    const result = await createProduct(merged);
    if (!result.ok) {
      return toolFail(
        result.reason,
        result.reason === "invalid_input"
          ? "Invalid product details. Check name/category/price values and correct them."
          : "Could not create the product. Tell the user it failed; do not pretend success.",
      );
    }
    return toolOk({ created: true, product: productSummary(result.data) });
  },
});

export const updateProductTool = tool({
  name: "update_product",
  description:
    "Update an existing product's details: name, category, price, description, SKU, low-stock threshold, or image. Only include the fields that should change; everything else stays as it is. For stock changes use set_product_stock / adjust_product_stock instead. If an image was attached by the user, ALWAYS include the imageUrl parameter with the URL from the attached image.",
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
  }),
  execute: async ({ productName, productId, ...changes }, ctx) => {
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
    const merged = {
      name: mergedChanges.name ?? current.name,
      category: mergedChanges.category ?? current.category,
      price: mergedChanges.price ?? current.price,
      description: orKeep(mergedChanges.description, current.description),
      sku: orKeep(mergedChanges.sku, current.sku),
      lowStockThreshold: mergedChanges.lowStockThreshold ?? current.lowStockThreshold,
      stockQuantity: current.stockQuantity,
      imageUrl: orKeep(mergedChanges.imageUrl, current.imageUrl),
    };

    console.log("[product-tools] updateProduct merged input:", JSON.stringify({ productName, ...merged }, null, 2));

    const result = await updateProduct(current.id, merged, { skipStock: true });
    if (!result.ok) {
      return toolFail(
        result.reason,
        result.reason === "invalid_input"
          ? "Invalid product details. Check the values and correct them."
          : result.reason === "sku_conflict"
            ? "That SKU is already used by another product. Ask for a different SKU."
            : "Product update failed. Do not claim success.",
      );
    }
    return toolOk({
      updated: true,
      product: productSummary(result.data),
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
    newStock: z.number().int().min(0),
  }),
  execute: async ({ productName, productId, newStock }) => {
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
    return toolOk({
      updated: true,
      previous_stock: target.stockQuantity,
      product: productSummary(result.data),
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
    delta: z.number().int(),
  }),
  execute: async ({ productName, productId, delta }) => {
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
    return toolOk({
      updated: true,
      delta,
      product: productSummary(result.data),
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
  execute: async ({ productName, productId, confirmed }) => {
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
        `Delete "${target.name}" (${target.category}, stock ${target.stockQuantity})`,
        `Kya aap sach mein "${target.name}" ko hataana chahte hain?`,
        `Kya aap sach mein "${target.name}" ko hataana chahte hain?`,
      );
    }
    const result = await deleteProduct(target.id);
    if (!result.ok) {
      return toolFail(result.reason, "Deletion failed. Do not claim success.");
    }
    return toolOk({ removed: true, name: target.name });
  },
});
