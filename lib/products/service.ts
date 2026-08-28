import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import {
  validateProductInput,
  validateStockDelta,
  validateStockValue,
} from "@/lib/products/validation";
import {
  computeProductStats,
  getStockStatus,
  type Product,
  type ProductStats,
  type StockStatus,
} from "@/lib/products/types";

/**
 * Product service layer — the ONLY place that talks to Supabase about
 * products. Ownership is always derived from the authenticated server-side
 * session (user -> owned business -> product.business_id); RLS is the second
 * enforcement layer. Future AI controlled tools should call these same
 * functions instead of duplicating logic.
 */

interface ProductRow {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  category: string;
  price: string | number;
  stock_quantity: number;
  low_stock_threshold: number;
  sku: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function mapProduct(row: ProductRow): Product {
  const price =
    typeof row.price === "number" ? row.price : Number.parseFloat(row.price);
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    description: row.description,
    category: row.category,
    price: Number.isFinite(price) ? price : 0,
    stockQuantity: row.stock_quantity,
    lowStockThreshold: row.low_stock_threshold,
    sku: row.sku,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ProductServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "not_found"
  | "sku_conflict"
  | "insufficient_stock"
  | "database_error";

export type ProductServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ProductServiceError };

/** Resolves the caller's session + owned business, or a failure reason. */
async function requireBusinessContext(): Promise<
  { ok: true; supabase: SupabaseClient; business: Business } | { ok: false; reason: ProductServiceError }
> {
  let user;
  let supabase: SupabaseClient;
  try {
    user = await getServerUser();
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }
  if (!user) return { ok: false, reason: "unauthenticated" };

  // Ownership always comes from the server session — never client input.
  const business = await getUserBusiness();
  if (!business) return { ok: false, reason: "no_business" };
  return { ok: true, supabase, business };
}

export interface GetProductsOptions {
  /** Case-insensitive match on name / SKU / category. */
  search?: string;
  /** Exact category match (case-insensitive). */
  category?: string;
  /** Filter by computed stock status. */
  status?: StockStatus | "all";
}

/**
 * Active products of the caller's business, newest first. At small-business
 * scale a single indexed query per business is the right trade-off; search
 * narrows in SQL, stock-status filtering compares each row against its own
 * threshold so it happens after fetch.
 */
export async function getProducts(
  options: GetProductsOptions = {},
): Promise<ProductServiceResult<Product[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  let query = context.supabase
    .from("products")
    .select("*")
    .eq("business_id", context.business.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  const search = options.search?.trim();
  if (search) {
    // Strip PostgREST operator syntax characters from user input.
    const safeTerm = search.replace(/[,()%\\*]/g, " ").trim();
    if (safeTerm.length > 0) {
      query = query.or(
        `name.ilike.%${safeTerm}%,sku.ilike.%${safeTerm}%,category.ilike.%${safeTerm}%`,
      );
    }
  }

  if (options.category && options.category !== "all") {
    query = query.ilike("category", options.category);
  }

  const { data, error } = await query;
  if (error) return { ok: false, reason: "database_error" };

  let products = ((data ?? []) as ProductRow[]).map(mapProduct);

  if (options.status && options.status !== "all") {
    products = products.filter(
      (product) =>
        getStockStatus(product.stockQuantity, product.lowStockThreshold) ===
        options.status,
    );
  }

  return { ok: true, data: products };
}

/** PostgREST returns this code when .single() matches zero rows. */
const NO_ROWS_CODE = "PGRST116";

export async function getProduct(
  productId: string,
): Promise<ProductServiceResult<Product>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("business_id", context.business.id)
    .maybeSingle();

  if (error) return { ok: false, reason: "database_error" };
  if (!data) return { ok: false, reason: "not_found" };
  return { ok: true, data: mapProduct(data as ProductRow) };
}

export async function createProduct(
  input: unknown,
): Promise<ProductServiceResult<Product>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateProductInput(input);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  console.log("[product-service] createProduct validated.imageUrl:", validated.value.imageUrl ?? "null");

  const { data, error } = await context.supabase
    .from("products")
    .insert({
      business_id: context.business.id,
      name: validated.value.name,
      description: validated.value.description,
      category: validated.value.category,
      price: validated.value.price,
      stock_quantity: validated.value.stockQuantity,
      low_stock_threshold: validated.value.lowStockThreshold,
      sku: validated.value.sku,
      image_url: validated.value.imageUrl,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return { ok: false, reason: "sku_conflict" };
    return { ok: false, reason: "database_error" };
  }
  return { ok: true, data: mapProduct(data as ProductRow) };
}

export interface UpdateProductOptions {
  /**
   * When true, the SQL UPDATE omits the stock_quantity column entirely. Used by
   * the AI update_product tool, which is NOT meant to change stock (stock has
   * its own dedicated tools). Writing stock here from a captured snapshot could
   * clobber a concurrent set_product_stock write in the same turn (race that
   * silently lost a stock change while both tools reported success).
   */
  skipStock?: boolean;
}

export async function updateProduct(
  productId: string,
  input: unknown,
  options: UpdateProductOptions = {},
): Promise<ProductServiceResult<Product>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateProductInput(input);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  console.log("[product-service] updateProduct validated.imageUrl:", validated.value.imageUrl ?? "null");

  const patch: Record<string, unknown> = {
    name: validated.value.name,
    description: validated.value.description,
    category: validated.value.category,
    price: validated.value.price,
    low_stock_threshold: validated.value.lowStockThreshold,
    sku: validated.value.sku,
    image_url: validated.value.imageUrl,
  };
  if (!options.skipStock) patch.stock_quantity = validated.value.stockQuantity;

  const { data, error } = await context.supabase
    .from("products")
    .update(patch)
    .eq("id", productId)
    .eq("business_id", context.business.id)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return { ok: false, reason: "sku_conflict" };
    if (error.code === NO_ROWS_CODE) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "database_error" };
  }
  return { ok: true, data: mapProduct(data as ProductRow) };
}

export async function updateStock(
  productId: string,
  stockValue: unknown,
): Promise<ProductServiceResult<Product>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateStockValue(stockValue);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  const { data, error } = await context.supabase
    .from("products")
    .update({ stock_quantity: validated.stockQuantity })
    .eq("id", productId)
    .eq("business_id", context.business.id)
    .select("*")
    .single();

  if (error) {
    if (error.code === NO_ROWS_CODE) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "database_error" };
  }
  return { ok: true, data: mapProduct(data as ProductRow) };
}

/**
 * Adds (positive delta) or removes (negative delta) stock for one product —
 * the inventory module's increase/decrease flow. The change is applied
 * relative to the stored value and the database's non-negative constraint
 * rejects removals below zero; the service maps that to a safe reason.
 */
export async function adjustProductStock(
  productId: string,
  delta: unknown,
): Promise<ProductServiceResult<Product>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateStockDelta(delta);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  const { data, error } = await context.supabase
    .rpc("adjust_product_stock", {
      p_product_id: productId,
      p_delta: validated.delta,
    })
    .single();

  if (error) {
    if (error.code === NO_ROWS_CODE) return { ok: false, reason: "not_found" };
    if (error.code === "P0001") {
      if (error.message.includes("NOT_ENOUGH_STOCK")) {
        return { ok: false, reason: "insufficient_stock" };
      }
      return { ok: false, reason: "not_found" };
    }
    return { ok: false, reason: "database_error" };
  }

  const row = data as ProductRow | null;
  if (!row || !row.id) return { ok: false, reason: "not_found" };
  return { ok: true, data: mapProduct(row) };
}

/**
 * "Delete" is an ARCHIVE: the row stays (is_active = false) so upcoming
 * Orders/Sales references and historical reports remain intact. The product
 * disappears from every active list immediately.
 */
export async function deleteProduct(
  productId: string,
): Promise<ProductServiceResult<{ id: string }>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("products")
    .update({ is_active: false })
    .eq("id", productId)
    .eq("business_id", context.business.id)
    .eq("is_active", true)
    .select("id")
    .single();

  if (error) {
    if (error.code === NO_ROWS_CODE) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "database_error" };
  }
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/** Real inventory summary used by the Products page and the dashboard. */
export async function getProductStats(): Promise<
  ProductServiceResult<ProductStats>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("products")
    .select("stock_quantity, low_stock_threshold")
    .eq("business_id", context.business.id)
    .eq("is_active", true);

  if (error) return { ok: false, reason: "database_error" };

  const rows = (data ?? []) as Array<{
    stock_quantity: number;
    low_stock_threshold: number;
  }>;

  return {
    ok: true,
    data: computeProductStats(
      rows.map((row) => ({
        stockQuantity: row.stock_quantity,
        lowStockThreshold: row.low_stock_threshold,
      })),
    ),
  };
}
