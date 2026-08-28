import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import {
  findById,
  limitSchema,
  resolveCustomer,
  resolveProduct,
  toolClarify,
  toolFail,
  toolNeedsConfirmation,
  toolOk,
  type ResolutionResult,
} from "@/lib/ai/tools/shared";
import { getCustomers } from "@/lib/customers/service";
import type { Product } from "@/lib/products/types";
import {
  createOrder,
  getOrders,
  updateOrderStatus,
  type OrderListItem,
} from "@/lib/orders/service";
import { isOrderStatus } from "@/lib/orders/types";
import { getProducts } from "@/lib/products/service";
import {
  getRecentSales,
  getSalesSummary,
  getTopSellingProducts,
  type SalesPeriodStats,
} from "@/lib/sales/service";

/**
 * Order & sales tools — controlled wrappers over the order and sales
 * services. Order creation prices authoritatively from the live products
 * table via the database function; the AI only supplies product references,
 * quantities and an optional customer.
 */

const ORDER_STATUSES = ["pending", "completed", "cancelled"] as const;

/** Accepted creation-status spellings from the model. The model frequently
 *  writes the natural completion word `complete` (singular) for a
 *  create-and-complete request; we normalize it to the DB's `completed`
 *  instead of letting the zod enum throw (docs/fix.txt). */
const ORDER_CREATE_STATUSES = ["pending", "completed", "complete"] as const;

function normalizeCreateStatus(
  value: (typeof ORDER_CREATE_STATUSES)[number] | undefined | null,
): "pending" | "completed" | undefined {
  if (value === "complete") return "completed";
  if (value === "pending" || value === "completed") return value;
  return undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function orderDetail(order: OrderListItem) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customerName: order.customerName ?? null,
    orderedAt: order.orderedAt,
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    notes: order.notes ?? null,
    items: order.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
  };
}

function orderMatchesSearch(order: OrderListItem, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    order.orderNumber.toLowerCase(),
    order.customerName?.toLowerCase() ?? "",
    ...order.items.map((item) => item.productName.toLowerCase()),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export const listOrdersTool = tool({
  name: "list_orders",
  description:
    "List the business's orders (newest first) with status, items and totals. Optional status filter ('pending'/'completed'/'cancelled') and search text (order number, customer or product name).",
  parameters: z.object({
    status: z.enum(ORDER_STATUSES).optional().nullable(),
    search: z.string().trim().max(120).optional().nullable(),
    limit: limitSchema(10, 25),
  }),
  execute: async ({ status, search, limit }) => {
    const result = await getOrders({
      status: status && isOrderStatus(status) ? status : undefined,
      search: search ?? undefined,
    });
    if (!result.ok) {
      return toolFail(result.reason, "Could not read orders. Ask the user to try again.");
    }
    const orders = result.data.filter((order) => orderMatchesSearch(order, search ?? ""));
    return toolOk({
      count: orders.length,
      truncated: orders.length > limit,
      orders: orders.slice(0, limit).map((order) => ({
        orderNumber: order.orderNumber,
        status: order.status,
        customerName: order.customerName ?? null,
        total: order.total,
        discount: order.discount,
        orderedAt: order.orderedAt,
        items: order.items.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      })),
    });
  },
});

export const findOrderTool = tool({
  name: "find_order",
  description:
    "Look up ONE order by its order number (e.g. 'ORD-104') and return full details: status, customer, items with quantities and unit prices, subtotal, discount, total, date. Use for 'order ki details batao' style questions. When you have previously listed ambiguous candidates, you may pass orderId to target the exact one the user picked.",
  parameters: z.object({
    orderNumber: z.string().trim().min(1).max(60).optional().nullable(),
    orderId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact order ID from a previous tool result when the user picked a specific candidate. Bypasses order-number search."),
  }),
  execute: async ({ orderNumber, orderId }) => {
    const result = await getOrders({ search: orderNumber ?? undefined });
    if (!result.ok) {
      return toolFail(result.reason, "Could not read orders. Ask the user to try again.");
    }
    if (orderId) {
      const byId = findById(result.data, orderId);
      if (!byId) {
        return toolFail("not_found", "No such order (by ID). Ask the user to re-check the listed candidates.");
      }
      return toolOk({ found: true, order: orderDetail(byId) });
    }
    const needle = (orderNumber ?? "").trim().toLowerCase();
    const exact = result.data.filter(
      (order) => order.orderNumber.toLowerCase() === needle,
    );
    if (exact.length === 1) {
      return toolOk({ found: true, order: orderDetail(exact[0]) });
    }
    if (exact.length > 1) {
      return toolClarify({
        multiple_matches: true,
        candidates: exact.map(orderDetail),
        hint: "Several orders share this number. Ask the user which one they mean.",
      });
    }
    const similar = result.data
      .filter((order) => order.orderNumber.toLowerCase().includes(needle))
      .slice(0, 5)
      .map((order) => ({
        orderNumber: order.orderNumber,
        status: order.status,
        customerName: order.customerName ?? null,
        total: order.total,
      }));
    if (similar.length > 0) {
      return toolOk({
        found: false,
        similar_orders: similar,
        hint: "No exact match. Show these close order numbers and ask which one they mean.",
      });
    }
    return toolFail("not_found", "No such order. Tell the user honestly.");
  },
});

export const createOrderTool = tool({
  name: "create_order",
  description:
    "Record a new sale/order. Provide product names with quantities; prices come from the catalog automatically. Customer is optional. If a product name does not exist or stock may be insufficient, check with find_product/list_products first — never invent product names. By default the order is created as 'pending'. If the user is recording a sale that is ALREADY complete ('order complete karo', 'sale record karo'), pass status='completed' so the order is genuinely completed (and stock deducted) in the database — never claim an order is complete unless the returned orderStatus is 'completed'.",
  parameters: z.object({
    items: z
      .array(
        z.object({
          productName: z.string().trim().min(1).max(160),
          productId: z.string().trim().max(60).optional().nullable().describe("Exact product ID from a previous tool result when the user picked a specific candidate. Bypasses name search."),
          quantity: z.number().int().min(1),
        }),
      )
      .min(1)
      .max(20),
    customerName: z.string().trim().max(160).optional().nullable(),
    customerId: z.string().trim().max(60).optional().nullable().describe("Exact customer ID from a previous tool result when the user picked a specific candidate. Bypasses name search."),
    status: z.enum(ORDER_CREATE_STATUSES).optional().nullable().describe("Optional. Defaults to 'pending'. Use 'completed' (or natural 'complete') only when the user is recording a sale/order that is already complete. The returned orderStatus is authoritative."),
    discount: z.number().min(0).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  }),
  // SDK catches parse/execute rejections and would otherwise swallow them into a
  // generic model-visible string. Log the REAL error server-side and return an
  // honest structured failure so the model never fabricates a vague "system
  // issue" message (docs/fix.txt).
  errorFunction: (_context, error) => {
    console.error("[tool][create_order] errorFunction caught real tool error:", error);
    return toolFail(
      "tool_error",
      "Could not record the order because of an internal error. Do not claim success; ask the user to try again.",
    );
  },
  execute: async ({ items, customerName, customerId, status, discount, notes }) => {
    const [productsResult, customersResult] = await Promise.all([
      getProducts(),
      getCustomers(),
    ]);
    if (!productsResult.ok || !customersResult.ok) {
      return toolFail("database_error", "Could not read catalog/customers. Ask the user to try again.");
    }

    // Resolve every product reference within THIS business only.
    const resolvedItems: Array<{ productId: string; quantity: number }> = [];
    const problems: string[] = [];
    for (const item of items) {
      let match: ResolutionResult<Product>;
      if (item.productId) {
        const byId = findById(productsResult.data, item.productId);
        if (!byId) {
          problems.push(`Product id "${item.productId}" not found in this business`);
          continue;
        }
        match = { kind: "found", item: byId };
      } else {
        match = resolveProduct(item.productName, productsResult.data);
      }
      if (match.kind === "not_found") {
        problems.push(`Product "${item.productName}" not found`);
      } else if (match.kind === "ambiguous") {
        problems.push(
          `"${item.productName}" matches several products: ${match.candidates.map((p) => `${p.name} (${p.category ?? "no category"}, id ${p.id})`).join(", ")}`,
        );
      } else {
        const stockLeft = match.item.stockQuantity - item.quantity;
        if (stockLeft < 0) {
          problems.push(
            `"${match.item.name}" has only ${match.item.stockQuantity} in stock (requested ${item.quantity})`,
          );
          continue;
        }
        resolvedItems.push({ productId: match.item.id, quantity: item.quantity });
      }
    }
    if (problems.length > 0) {
      return toolClarify({
        created: false,
        problems,
        hint: "Explain the problems and ask the user how to proceed. Do not create the order.",
      });
    }

    let resolvedCustomerId: string | null = null;
    if (customerId) {
      const byId = findById(customersResult.data, customerId);
      if (!byId) {
        return toolClarify({
          created: false,
          problems: [`Customer id "${customerId}" not found in this business`],
          hint: "Ask the user to re-check the listed candidates.",
        });
      }
      resolvedCustomerId = byId.id;
    } else if (customerName && customerName.trim()) {
      const match = resolveCustomer(customerName, customersResult.data);
      if (match.kind === "not_found") {
        return toolClarify({
          created: false,
          problems: [`Customer "${customerName}" not found`],
          hint: "Offer to save this customer first or record it as a walk-in without a customer.",
        });
      }
      if (match.kind === "ambiguous") {
        return toolClarify({
          created: false,
          problems: [
            `Customer "${customerName}" matches several saved customers: ${match.candidates.map((c) => `${c.name} (id ${c.id})`).join(", ")}`,
          ],
          hint: "Ask the user which customer they mean.",
        });
      }
      resolvedCustomerId = match.item.id;
    }

    const result = await createOrder({
      customerId: resolvedCustomerId,
      status: normalizeCreateStatus(status),
      discount: discount ?? 0,
      notes: notes ?? null,
      orderedAt: null,
      items: resolvedItems,
    });
    if (!result.ok) {
      return toolFail(
        result.reason,
        result.reason === "insufficient_stock"
          ? "Not enough stock for one of the items. Check stock and tell the user."
          : "Could not create the order. Do not claim success.",
      );
    }
    return toolOk({
      created: true,
      orderNumber: result.data.orderNumber,
      // Authoritative creation status read back from the database row — the
      // model MUST report this value and never claim completion unless it is
      // "completed" (docs/fix.txt). Named orderStatus because `status` is the
      // reserved toolOk success sentinel ("status":"ok").
      orderStatus: result.data.status,
      total: result.data.total,
      subtotal: result.data.subtotal,
      discount: result.data.discount,
      items: result.data.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    });
  },
});

export const updateOrderStatusTool = tool({
  name: "update_order_status",
  description:
    "Change an order's status: 'pending', 'completed' (records the sale and deducts remaining stock) or 'cancelled'. Cancelling is consequential and requires the user's explicit confirmation in a previous turn before confirmed=true may be used.",
  parameters: z.object({
    orderNumber: z.string().trim().min(1).max(60).optional().nullable(),
    orderId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact order ID from a previous tool result when the user picked a specific candidate. Bypasses order-number search."),
    status: z.enum(ORDER_STATUSES),
    confirmed: z.boolean().default(false),
  }),
  errorFunction: (_context, error) => {
    console.error("[tool][update_order_status] errorFunction caught real tool error:", error);
    return toolFail(
      "tool_error",
      "Could not update the order status because of an internal error. Do not claim success; ask the user to try again.",
    );
  },
  execute: async ({ orderNumber, orderId, status, confirmed }) => {
    const result = await getOrders({ search: orderNumber ?? undefined });
    if (!result.ok) {
      return toolFail(result.reason, "Could not read orders. Ask the user to try again.");
    }
    const target = orderId
      ? findById(result.data, orderId)
      : result.data.find(
          (order) => order.orderNumber.toLowerCase() === (orderNumber ?? "").trim().toLowerCase(),
        );
    if (!target) {
      return toolFail("not_found", "No such order. Tell the user honestly.");
    }
    if (target.status === status) {
      return toolOk({ updated: false, already_in_status: true, orderNumber: target.orderNumber, newStatus: status });
    }

    if (status === "cancelled" && !confirmed) {
      return toolNeedsConfirmation(
        `Cancel order ${target.orderNumber} (${target.customerName ?? "walk-in"}, total ${target.total})`,
        `Order ${target.orderNumber} cancel karna hai?`,
        `Kya aap order ${target.orderNumber} cancel karna chahte hain?`,
      );
    }

    const update = await updateOrderStatus(target.id, status);
    if (!update.ok) {
      return toolFail(update.reason, "Status change failed. Do not claim success.");
    }
    return toolOk({ updated: true, orderNumber: update.data.orderNumber, newStatus: update.data.status });
  },
});

function salesPeriod(stats: SalesPeriodStats) {
  return {
    revenue: round2(stats.revenue),
    orderCount: stats.orderCount,
    averageOrderValue:
      stats.orderCount > 0 ? round2(stats.revenue / stats.orderCount) : 0,
  };
}

export const salesSummaryTool = tool({
  name: "sales_summary",
  description:
    "Real revenue summary from completed sales: today, yesterday, this week, last week, this month, last month and all time. Each period has revenue, completed order count and average order value. Answers 'aj ki sales kitni hui?', 'pichle hafte kitni sale hui thi?', 'average order kitna hai?'.",
  parameters: z.object({}),
  execute: async () => {
    const result = await getSalesSummary();
    if (!result.ok) {
      return toolFail(result.reason, "Could not read sales. Ask the user to try again.");
    }
    const summary = result.data;
    return toolOk({
      today: salesPeriod(summary.today),
      yesterday: salesPeriod(summary.yesterday),
      week: salesPeriod(summary.week),
      lastWeek: salesPeriod(summary.lastWeek),
      month: salesPeriod(summary.month),
      lastMonth: salesPeriod(summary.lastMonth),
      allTime: salesPeriod(summary.allTime),
    });
  },
});

export const topSellingProductsTool = tool({
  name: "top_selling_products",
  description:
    "Best-selling products ranked by units sold from real completed orders inside a look-back window (default last 30 days; days=1 means today). Answers 'sabse zyada kya bik raha hai?' / 'aaj sabse zyada kya bika?'.",
  parameters: z.object({
    days: z.number().int().min(1).max(365).optional().default(30),
    limit: limitSchema(5, 20),
  }),
  execute: async ({ days, limit }) => {
    const result = await getTopSellingProducts({ days, limit });
    if (!result.ok) {
      return toolFail(result.reason, "Could not read sales. Ask the user to try again.");
    }
    return toolOk({ days, count: result.data.length, products: result.data });
  },
});

export const recentSalesTool = tool({
  name: "recent_sales",
  description:
    "The most recent completed sales entries with customer names, amounts and dates.",
  parameters: z.object({
    limit: limitSchema(8, 20),
  }),
  execute: async ({ limit }) => {
    const result = await getRecentSales(limit);
    if (!result.ok) {
      return toolFail(result.reason, "Could not read sales. Ask the user to try again.");
    }
    return toolOk({ count: result.data.length, sales: result.data });
  },
});
