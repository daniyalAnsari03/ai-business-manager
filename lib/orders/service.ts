import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import { validateOrderInput, validateOrderStatus } from "@/lib/orders/validation";
import {
  isOrderStatus,
  toNumber,
  type Order,
  type OrderInput,
  type OrderItem,
  type OrderStatus,
  type OrderWithItems,
} from "@/lib/orders/types";

/**
 * Order service layer — the ONLY place that talks to Supabase about orders.
 * Creation, status changes and deletion run through atomic database
 * functions that verify ownership from auth.uid() themselves and enforce
 * money identities + idempotent inventory handling; RLS is the second
 * boundary. Future AI controlled tools should call these same functions.
 */

interface OrderRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  order_number: string;
  status: string;
  subtotal: string | number;
  discount: string | number;
  total: string | number;
  notes: string | null;
  ordered_at: string;
  created_at: string;
  updated_at: string;
}

interface OrderItemRow {
  id: string;
  order_id: string;
  business_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: string | number;
  quantity: number;
  line_total: string | number;
}

function mapOrder(row: OrderRow): Order {
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    orderNumber: row.order_number,
    status: isOrderStatus(row.status) ? row.status : "pending",
    subtotal: toNumber(row.subtotal),
    discount: toNumber(row.discount),
    total: toNumber(row.total),
    notes: row.notes,
    orderedAt: row.ordered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOrderItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    orderId: row.order_id,
    businessId: row.business_id,
    productId: row.product_id,
    productName: row.product_name,
    unitPrice: toNumber(row.unit_price),
    quantity: row.quantity,
    lineTotal: toNumber(row.line_total),
  };
}

export type OrderServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "not_found"
  | "customer_invalid"
  | "product_not_found"
  | "items_empty"
  | "items_too_many"
  | "invalid_quantity"
  | "discount_invalid"
  | "insufficient_stock"
  | "invalid_status"
  | "delete_not_allowed"
  | "database_error";

export type OrderServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: OrderServiceError };

async function requireBusinessContext(): Promise<
  { ok: true; supabase: SupabaseClient; business: Business } | { ok: false; reason: OrderServiceError }
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

  const business = await getUserBusiness();
  if (!business) return { ok: false, reason: "no_business" };
  return { ok: true, supabase, business };
}

/** Maps database-function error codes onto safe service reasons. */
function mapRpcError(error: unknown): OrderServiceError {
  const raw =
    typeof error === "object" && error !== null && "error" in error
      ? String((error as { error: unknown }).error)
      : "";
  switch (raw) {
    case "NO_BUSINESS":
      return "no_business";
    case "CUSTOMER_INVALID":
      return "customer_invalid";
    case "PRODUCT_NOT_FOUND":
      return "product_not_found";
    case "ITEMS_EMPTY":
      return "items_empty";
    case "ITEMS_TOO_MANY":
      return "items_too_many";
    case "INVALID_QUANTITY":
      return "invalid_quantity";
    case "DISCOUNT_INVALID":
      return "discount_invalid";
    case "INSUFFICIENT_STOCK":
      return "insufficient_stock";
    case "INVALID_STATUS":
      return "invalid_status";
    case "NOT_FOUND":
      return "not_found";
    case "DELETE_NOT_ALLOWED":
      return "delete_not_allowed";
    default:
      return "database_error";
  }
}

/** Customer display names for the caller's business (id -> name). */
async function getCustomerNameMap(
  supabase: SupabaseClient,
  businessId: string,
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("customers")
    .select("id, name")
    .eq("business_id", businessId);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
    map.set(row.id, row.name);
  }
  return map;
}

export interface GetOrdersOptions {
  /** Case-insensitive match on order number / item product name. */
  search?: string;
  /** Exact status filter. */
  status?: OrderStatus | "all";
}

/** Order enriched with the customer's display name — no line items. */
export interface OrderSummary extends Order {
  customerName: string | null;
}

/** Full list row: summary plus its line items, as the Orders module uses. */
export interface OrderListItem extends OrderSummary {
  items: OrderItem[];
}

/**
 * Orders of the caller's business, newest first, each enriched with its
 * line items and the customer's display name.
 */
export async function getOrders(
  options: GetOrdersOptions = {},
): Promise<OrderServiceResult<OrderListItem[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  let query = context.supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("business_id", context.business.id)
    .order("ordered_at", { ascending: false })
    .limit(500);

  if (options.status && options.status !== "all") {
    query = query.eq("status", options.status);
  }

  const [{ data, error }, customerNames] = await Promise.all([
    query,
    getCustomerNameMap(context.supabase, context.business.id),
  ]);

  if (error) return { ok: false, reason: "database_error" };

  let orders = ((data ?? []) as Array<OrderRow & { order_items: OrderItemRow[] | null }>).map(
    (row) => ({
      ...mapOrder(row),
      items: (row.order_items ?? []).map(mapOrderItem),
      customerName: row.customer_id
        ? customerNames.get(row.customer_id) ?? null
        : null,
    }),
  );

  const search = options.search?.trim().toLowerCase();
  if (search) {
    orders = orders.filter((order) => {
      const haystack = [
        order.orderNumber.toLowerCase(),
        order.customerName?.toLowerCase() ?? "",
        ...order.items.map((item) => item.productName.toLowerCase()),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  }

  return { ok: true, data: orders };
}

export async function getOrder(
  orderId: string,
): Promise<OrderServiceResult<OrderWithItems>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", orderId)
    .eq("business_id", context.business.id)
    .maybeSingle();

  if (error) return { ok: false, reason: "database_error" };
  if (!data) return { ok: false, reason: "not_found" };

  const row = data as OrderRow & { order_items: OrderItemRow[] | null };
  return {
    ok: true,
    data: {
      ...mapOrder(row),
      items: (row.order_items ?? []).map(mapOrderItem),
    },
  };
}

/**
 * A single customer's orders (newest first) with line items and customer
 * display name — powers customer order-history questions.
 */
export async function getOrdersByCustomer(
  customerId: string,
  limit = 10,
): Promise<OrderServiceResult<OrderListItem[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const [{ data, error }, customerNames] = await Promise.all([
    context.supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("business_id", context.business.id)
      .eq("customer_id", customerId)
      .order("ordered_at", { ascending: false })
      .limit(Math.min(Math.max(Math.floor(limit) || 10, 1), 25)),
    getCustomerNameMap(context.supabase, context.business.id),
  ]);

  if (error) return { ok: false, reason: "database_error" };

  return {
    ok: true,
    data: ((data ?? []) as Array<OrderRow & { order_items: OrderItemRow[] | null }>).map(
      (row) => ({
        ...mapOrder(row),
        items: (row.order_items ?? []).map(mapOrderItem),
        customerName: row.customer_id
          ? customerNames.get(row.customer_id) ?? null
          : null,
      }),
    ),
  };
}

/** Most recent orders (any status) — used by the dashboard. */
export async function getRecentOrders(
  limit = 5,
): Promise<OrderServiceResult<OrderSummary[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const [{ data, error }, customerNames] = await Promise.all([
    context.supabase
      .from("orders")
      .select("*")
      .eq("business_id", context.business.id)
      .order("ordered_at", { ascending: false })
      .limit(limit),
    getCustomerNameMap(context.supabase, context.business.id),
  ]);

  if (error) return { ok: false, reason: "database_error" };

  return {
    ok: true,
    data: ((data ?? []) as OrderRow[]).map((row) => ({
      ...mapOrder(row),
      customerName: row.customer_id
        ? customerNames.get(row.customer_id) ?? null
        : null,
    })),
  };
}

/**
 * Creates an order atomically through the database function: prices are
 * taken authoritatively from the live products table, totals are computed
 * server-side, and header + items commit together or not at all.
 */
export async function createOrder(
  input: unknown,
): Promise<OrderServiceResult<OrderWithItems>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateOrderInput(input);
  if (!validated.ok) return { ok: false, reason: "invalid_input" };

  const payload = validated.value satisfies OrderInput;

  const { data, error } = await context.supabase.rpc("create_business_order", {
    p_payload: payload,
  });

  // The RPC-level error (or null data) is the REAL failure signal; map and log
  // it instead of discarding it into a generic "database_error" that hid the
  // underlying cause from the AI route (docs/fix.txt).
  if (error || !data) {
    console.error(
      "[order-service] create_business_order RPC call failed. error=",
      error,
      "data=",
      data,
      "payload=",
      JSON.stringify(payload),
    );
    return { ok: false, reason: mapRpcError(error) };
  }

  const result = data as {
    ok: boolean;
    error?: string;
    order?: OrderRow;
    items?: OrderItemRow[];
  };
  if (!result.ok || !result.order) {
    console.error(
      "[order-service] create_business_order returned failure. error_code=",
      result.error ?? "(none)",
      "detail=",
      "detail" in result ? (result as { detail?: unknown }).detail : "(none)",
      "data=",
      JSON.stringify(result),
    );
    return { ok: false, reason: mapRpcError(result) };
  }

  return {
    ok: true,
    data: {
      ...mapOrder(result.order),
      items: (result.items ?? []).map(mapOrderItem),
    },
  };
}

/**
 * Status transition with built-in inventory consistency: entering
 * "completed" deducts stock exactly once; leaving it restores exactly what
 * was deducted; insufficient stock refuses the whole transition atomically.
 */
export async function updateOrderStatus(
  orderId: string,
  status: unknown,
): Promise<OrderServiceResult<Order>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const validated = validateOrderStatus(status);
  if (!validated.ok) return { ok: false, reason: "invalid_status" };

  const { data, error } = await context.supabase.rpc("update_order_status", {
    p_order_id: orderId,
    p_status: validated.status,
  });

  if (error || !data) {
    console.error(
      "[order-service] update_order_status RPC call failed. error=",
      error,
      "data=",
      data,
    );
    return { ok: false, reason: mapRpcError(error) };
  }

  const result = data as { ok: boolean; error?: string; order?: OrderRow };
  if (!result.ok || !result.order) {
    console.error(
      "[order-service] update_order_status returned failure. error_code=",
      result.error ?? "(none)",
      "data=",
      JSON.stringify(result),
    );
    return { ok: false, reason: mapRpcError(result) };
  }
  return { ok: true, data: mapOrder(result.order) };
}

/**
 * Hard-deletes an order. Only reachable for orders that were never
 * completed — the database refuses otherwise so financial history stays
 * protected; cancellations are the supported path instead.
 */
export async function deleteOrder(
  orderId: string,
): Promise<OrderServiceResult<{ id: string }>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase.rpc("delete_business_order", {
    p_order_id: orderId,
  });

  if (error || !data) {
    console.error(
      "[order-service] delete_business_order RPC call failed. error=",
      error,
      "data=",
      data,
    );
    return { ok: false, reason: mapRpcError(error) };
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) {
    console.error(
      "[order-service] delete_business_order returned failure. error_code=",
      result.error ?? "(none)",
      "data=",
      JSON.stringify(result),
    );
    return { ok: false, reason: mapRpcError(result) };
  }
  return { ok: true, data: { id: orderId } };
}

export interface OrderStats {
  total: number;
  pending: number;
  completed: number;
  cancelled: number;
}

/** Real order counters for the dashboard (single indexed scans). */
export async function getOrderStats(): Promise<
  OrderServiceResult<OrderStats>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("orders")
    .select("status")
    .eq("business_id", context.business.id);

  if (error) return { ok: false, reason: "database_error" };

  const stats: OrderStats = { total: 0, pending: 0, completed: 0, cancelled: 0 };
  for (const row of (data ?? []) as Array<{ status: string }>) {
    stats.total += 1;
    if (row.status === "pending") stats.pending += 1;
    else if (row.status === "completed") stats.completed += 1;
    else if (row.status === "cancelled") stats.cancelled += 1;
  }
  return { ok: true, data: stats };
}
