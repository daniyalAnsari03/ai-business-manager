import { getProducts } from "@/lib/products/service";
import {
  computeProductStats,
  type ProductStats,
} from "@/lib/products/types";
import { getCustomerCount } from "@/lib/customers/service";
import {
  getOrderStats,
  getRecentOrders,
  type OrderSummary,
} from "@/lib/orders/service";
import { getSalesSummary, type SalesSummary } from "@/lib/sales/service";
import { getExpenseStats, type ExpenseStats } from "@/lib/expenses/service";

/**
 * Dashboard metrics — one honest snapshot of the whole business, composed
 * exclusively of the module services' real data. Nothing here is ever
 * fabricated; when a source fails its section reports null and the UI keeps
 * the truthful "not available" state.
 */

export interface LowStockEntry {
  id: string;
  name: string;
  stockQuantity: number;
  lowStockThreshold: number;
}

export interface DashboardMetrics {
  productStats: ProductStats | null;
  /** Active products that are low or out of stock, most critical first. */
  lowStockProducts: LowStockEntry[];
  customerCount: number | null;
  orderStats: { total: number; pending: number; completed: number } | null;
  salesSummary: SalesSummary | null;
  expenseStats: ExpenseStats | null;
  recentOrders: OrderSummary[];
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const [activeResult, customersResult, ordersResult, salesResult, expensesResult, recentOrdersResult] =
    await Promise.all([
      // One products fetch feeds BOTH the stats summary and the low-stock
      // list — previously the same table was queried twice per dashboard
      // load. Same source of truth, half the round trips.
      getProducts(),
      getCustomerCount(),
      getOrderStats(),
      getSalesSummary(),
      getExpenseStats(),
      getRecentOrders(5),
    ]);

  let productStats: ProductStats | null = null;
  let lowStockProducts: LowStockEntry[] = [];
  if (activeResult.ok) {
    const active = activeResult.data;
    productStats = computeProductStats(active);
    lowStockProducts = active
      .filter(
        (product) =>
          product.stockQuantity <= 0 ||
          product.stockQuantity <= product.lowStockThreshold,
      )
      .sort((a, b) => a.stockQuantity - b.stockQuantity)
      .slice(0, 5)
      .map((product) => ({
        id: product.id,
        name: product.name,
        stockQuantity: product.stockQuantity,
        lowStockThreshold: product.lowStockThreshold,
      }));
  }

  return {
    productStats,
    lowStockProducts,
    customerCount: customersResult.ok ? customersResult.data : null,
    orderStats: ordersResult.ok
      ? {
          total: ordersResult.data.total,
          pending: ordersResult.data.pending,
          completed: ordersResult.data.completed,
        }
      : null,
    salesSummary: salesResult.ok ? salesResult.data : null,
    expenseStats: expensesResult.ok ? expensesResult.data : null,
    recentOrders: recentOrdersResult.ok ? recentOrdersResult.data : [],
  };
}
