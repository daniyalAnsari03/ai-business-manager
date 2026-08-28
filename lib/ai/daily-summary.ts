import "server-only";

import { getUserBusiness } from "@/lib/business/service";
import { getDashboardMetrics } from "@/lib/dashboard/service";
import { getCurrency } from "@/lib/business/constants";
import type { Language } from "@/lib/business/types";
import { saveAssistantMessage, touchConversation, createConversation } from "@/lib/ai/chat-service";

/**
 * Daily business summary generator.
 * Generates a concise summary of yesterday's business activity and inserts
 * it as a new conversation in the AI Manager chat for the business owner
 * to see when they next open the app.
 */

function formatCurrency(amount: number, currencyCode: string): string {
  const currency = getCurrency(currencyCode);
  const symbol = currency?.symbol ?? currencyCode;
  return `${symbol} ${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function buildSummaryText(
  language: Language,
  businessName: string,
  data: {
    yesterdayRevenue: number;
    yesterdayOrders: number;
    monthRevenue: number;
    monthOrders: number;
    monthExpenses: number;
    lowStockItems: Array<{ name: string; stock: number }>;
    totalProducts: number;
    totalCustomers: number;
  },
  currencyCode: string,
): string {
  const lines: string[] = [];

  if (language === "ur") {
    lines.push(`Assalam-o-Alaikum! Ye hai "${businessName}" ka aj ka business summary.`);
    lines.push("");
    lines.push("--- SALES ---");
    lines.push(`Kal ki sales: ${formatCurrency(data.yesterdayRevenue, currencyCode)} (${data.yesterdayOrders} orders)`);
    lines.push(`Is mahine ki total sales: ${formatCurrency(data.monthRevenue, currencyCode)} (${data.monthOrders} orders)`);
    lines.push("");
    lines.push("--- KHARCHE ---");
    lines.push(`Is mahine ke kharche: ${formatCurrency(data.monthExpenses, currencyCode)}`);
    lines.push(`Sales minus kharche: ${formatCurrency(data.monthRevenue - data.monthExpenses, currencyCode)}`);
    lines.push("");
    lines.push("--- INVENTORY ---");
    lines.push(`Kul products: ${data.totalProducts}`);
    if (data.lowStockItems.length > 0) {
      lines.push(`Stock kam hone wale products (${data.lowStockItems.length}):`);
      for (const item of data.lowStockItems.slice(0, 5)) {
        lines.push(`  - ${item.name}: ${item.stock} bacha hai`);
      }
      if (data.lowStockItems.length > 5) {
        lines.push(`  ... aur ${data.lowStockItems.length - 5} aur`);
      }
    } else {
      lines.push("Sab products ka stock theek hai.");
    }
    lines.push("");
    lines.push("--- SUMMARY ---");
    lines.push(`Customers: ${data.totalCustomers}`);
    lines.push("");
    lines.push("Koi aur sawal ho to AI Manager se poochein!");
  } else {
    lines.push(`Good morning! Here's today's business summary for "${businessName}".`);
    lines.push("");
    lines.push("--- SALES ---");
    lines.push(`Yesterday's sales: ${formatCurrency(data.yesterdayRevenue, currencyCode)} (${data.yesterdayOrders} orders)`);
    lines.push(`This month's total: ${formatCurrency(data.monthRevenue, currencyCode)} (${data.monthOrders} orders)`);
    lines.push("");
    lines.push("--- EXPENSES ---");
    lines.push(`This month's expenses: ${formatCurrency(data.monthExpenses, currencyCode)}`);
    lines.push(`Sales minus expenses: ${formatCurrency(data.monthRevenue - data.monthExpenses, currencyCode)}`);
    lines.push("");
    lines.push("--- INVENTORY ---");
    lines.push(`Total products: ${data.totalProducts}`);
    if (data.lowStockItems.length > 0) {
      lines.push(`Low stock items (${data.lowStockItems.length}):`);
      for (const item of data.lowStockItems.slice(0, 5)) {
        lines.push(`  - ${item.name}: ${item.stock} left`);
      }
      if (data.lowStockItems.length > 5) {
        lines.push(`  ... and ${data.lowStockItems.length - 5} more`);
      }
    } else {
      lines.push("All products are well stocked.");
    }
    lines.push("");
    lines.push("--- SUMMARY ---");
    lines.push(`Customers: ${data.totalCustomers}`);
    lines.push("");
    lines.push("Have any questions? Just ask your AI Manager!");
  }

  return lines.join("\n");
}

/**
 * Generate and persist a daily business summary for a single business.
 * Returns the conversation ID so the caller can reference it.
 */
export async function generateDailySummary(): Promise<
  { ok: true; conversationId: string } | { ok: false; reason: string }
> {
  const business = await getUserBusiness();
  if (!business) return { ok: false, reason: "no_business" };

  const metrics = await getDashboardMetrics();

  const sales = metrics.salesSummary;
  const expenses = metrics.expenseStats;
  const lowStockItems = metrics.lowStockProducts.map((p) => ({
    name: p.name,
    stock: p.stockQuantity,
  }));

  const data = {
    yesterdayRevenue: sales?.yesterday.revenue ?? 0,
    yesterdayOrders: sales?.yesterday.orderCount ?? 0,
    monthRevenue: sales?.month.revenue ?? 0,
    monthOrders: sales?.month.orderCount ?? 0,
    monthExpenses: expenses?.monthTotal ?? 0,
    lowStockItems,
    totalProducts: metrics.productStats?.totalProducts ?? 0,
    totalCustomers: metrics.customerCount ?? 0,
  };

  const summaryText = buildSummaryText(
    business.language,
    business.name,
    data,
    business.currency,
  );

  // Create a new conversation with the summary title.
  const convResult = await createConversation(
    business.language === "ur" ? "Rozana business summary" : "Daily business summary",
  );
  if (!convResult.ok) {
    return { ok: false, reason: convResult.reason };
  }

  const conversationId = convResult.data.id;

  // Save the summary as an assistant message.
  const msgResult = await saveAssistantMessage(conversationId, summaryText, []);
  if (!msgResult.ok) {
    return { ok: false, reason: msgResult.reason };
  }

  await touchConversation(conversationId);

  return { ok: true, conversationId };
}
