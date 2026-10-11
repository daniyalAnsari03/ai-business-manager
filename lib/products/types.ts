/** Product domain types shared by the service layer, server actions and UI. */

import type { ProductAttributes } from "@/lib/business/product-attributes";

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
  /**
   * Business-type-specific facts, always an object and never null. For clothing
   * businesses this holds { product_type, fabric, color, design, size }; for
   * every other business type it stays {} unless that type gains its own
   * vocabulary. A row written before this column existed reads as {}.
   */
  attributes: ProductAttributes;
  /**
   * Unit LABEL shown next to a quantity ("50 Meter", "2 Piece"). It is a label
   * only: stock quantities stay whole numbers and no arithmetic uses this.
   * A row without the column reads as "Piece".
   */
  unit: string;
  /**
   * Price the business paid for one unit, in major currency units. null means
   * "unknown / not recorded yet" and is never defaulted to 0, because a
   * fabricated cost would silently turn a profit report into a lie.
   */
  costPrice: number | null;
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

/**
 * The OPTIONAL business-type-specific extras a create/update payload may also
 * carry (docs/p1.txt — File 3 / Phase 2).
 *
 * All three value keys are optional on purpose: an update that omits one leaves
 * the stored value completely untouched (never "reset to a default"), and a
 * create that omits one stores the honest default — attributes {}, unit
 * "Piece", cost price null (not set). They are validated separately from
 * {@link ProductInput} because attributes depend on the business type, which
 * only the service layer knows (server-side, never model input).
 *
 * `clearAttributes` is write-only and never stored: it names the attribute keys
 * an UPDATE should remove. Removing a key always goes through this explicit
 * list so an update that only changes one attribute can never wipe the others.
 *
 * `clearCostPrice` is the same idea for the cost price column (docs/p5.txt).
 * An omitted `costPrice` has always meant "leave the stored cost alone", which
 * is exactly what makes a recorded cost price impossible to erase by emptying
 * a form field. Erasing it is therefore its own explicit, additive instruction:
 * set this flag to true and cost_price becomes NULL. Sending a new costPrice
 * AND this flag together is a contradiction, so it is a reported validation
 * error rather than a guess about which one the caller meant.
 */
export interface ProductWriteExtrasInput {
  attributes?: ProductAttributes | null;
  clearAttributes?: readonly string[] | null;
  unit?: string | null;
  costPrice?: number | null;
  clearCostPrice?: boolean | null;
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
