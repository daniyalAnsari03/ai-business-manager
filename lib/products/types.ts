/** Product domain types shared by the service layer, server actions and UI. */

export interface Product {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  category: string;
  /** Price in major currency units (e.g. rupees), never negative. */
  price: number;
  stockQuantity: number;
  lowStockThreshold: number;
  sku: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating a product (stock included) or editing its details. */
export interface ProductInput {
  name: string;
  description: string | null;
  category: string;
  price: number;
  stockQuantity: number;
  lowStockThreshold: number;
  sku: string | null;
  imageUrl: string | null;
}

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

/**
 * Stock meaning is kept simple and honest:
 *   0                      -> out of stock
 *   <= low_stock_threshold -> low stock
 *   otherwise              -> in stock
 */
export function getStockStatus(
  stockQuantity: number,
  lowStockThreshold: number,
): StockStatus {
  if (stockQuantity <= 0) return "out_of_stock";
  if (stockQuantity <= lowStockThreshold) return "low_stock";
  return "in_stock";
}

export interface ProductStats {
  totalProducts: number;
  lowStockCount: number;
  outOfStockCount: number;
}

/** Only the stock fields are needed to compute the summary. */
export type StockLike = Pick<Product, "stockQuantity" | "lowStockThreshold">;

export function computeProductStats(products: readonly StockLike[]): ProductStats {
  let lowStockCount = 0;
  let outOfStockCount = 0;
  for (const product of products) {
    const status = getStockStatus(product.stockQuantity, product.lowStockThreshold);
    if (status === "low_stock") lowStockCount += 1;
    else if (status === "out_of_stock") outOfStockCount += 1;
  }
  return {
    totalProducts: products.length,
    lowStockCount,
    outOfStockCount,
  };
}
