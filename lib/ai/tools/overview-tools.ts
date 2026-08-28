import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import { toolFail, toolOk } from "@/lib/ai/tools/shared";
import { getDashboardMetrics } from "@/lib/dashboard/service";

/**
 * Business overview tool — one honest cross-module snapshot composed by the
 * same dashboard service the Dashboard page uses (nulls mean that module's
 * data is unavailable; never fabricated).
 */
export const businessOverviewTool = tool({
  name: "business_overview",
  description:
    "One combined snapshot of the whole business: sales (today/yesterday/week/month/all time), order counts by status, customer count, inventory totals with low/out-of-stock counts, top low-stock items and expense totals (today/week/month) including sales-minus-expenses differences. Use for 'mera business kaisa chal raha hai?' and 'aaj/mahine ka business summary' style questions.",
  parameters: z.object({}),
  execute: async () => {
    const metrics = await getDashboardMetrics();
    if (
      metrics.salesSummary === null &&
      metrics.productStats === null &&
      metrics.customerCount === null &&
      metrics.orderStats === null &&
      metrics.expenseStats === null
    ) {
      return toolFail("database_error", "Business data is unavailable right now.");
    }

    const sales = metrics.salesSummary;
    const expenses = metrics.expenseStats;
    // Difference between completed-order revenue and recorded expenses.
    // This is NOT profit: the app does not track product costs.
    const difference =
      sales !== null && expenses !== null
        ? {
            today: Math.round((sales.today.revenue - expenses.todayTotal) * 100) / 100,
            thisMonth:
              Math.round((sales.month.revenue - expenses.monthTotal) * 100) / 100,
          }
        : null;

    return toolOk({
      sales,
      orders: metrics.orderStats,
      customers: metrics.customerCount !== null ? { count: metrics.customerCount } : null,
      inventory: metrics.productStats,
      lowStockItems: metrics.lowStockProducts.map((product) => ({
        name: product.name,
        stock: product.stockQuantity,
        threshold: product.lowStockThreshold,
      })),
      expenses,
      salesMinusExpenses: difference,
    });
  },
});
