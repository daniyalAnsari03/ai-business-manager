"use server";

import {
  createOrder,
  deleteOrder,
  getOrder,
  getOrders,
  updateOrderStatus,
  type OrderListItem,
  type OrderServiceError,
} from "@/lib/orders/service";
import type {
  Order,
  OrderStatus,
  OrderWithItems,
} from "@/lib/orders/types";

export type OrderActionState =
  | { ok: true; order: OrderWithItems }
  | { ok: false; reason: OrderServiceError };

export type OrderStatusActionState =
  | { ok: true; order: Order }
  | { ok: false; reason: OrderServiceError };

export type OrderListActionState =
  | { ok: true; orders: OrderListItem[] }
  | { ok: false; reason: OrderServiceError };

/**
 * Thin server-action boundary over the order service. Creation and status
 * changes run through atomic database functions inside the service —
 * totals are computed server-side and inventory stays consistent.
 */

export async function createOrderAction(
  input: unknown,
): Promise<OrderActionState> {
  const result = await createOrder(input);
  return result.ok
    ? { ok: true, order: result.data }
    : { ok: false, reason: result.reason };
}

export async function updateOrderStatusAction(
  orderId: string,
  status: OrderStatus,
): Promise<OrderStatusActionState> {
  const result = await updateOrderStatus(orderId, status);
  return result.ok
    ? { ok: true, order: result.data }
    : { ok: false, reason: result.reason };
}

export async function deleteOrderAction(
  orderId: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: OrderServiceError }> {
  const result = await deleteOrder(orderId);
  return result.ok
    ? { ok: true, id: result.data.id }
    : { ok: false, reason: result.reason };
}

export async function getOrdersAction(
  options: Parameters<typeof getOrders>[0] = {},
): Promise<OrderListActionState> {
  const result = await getOrders(options);
  return result.ok
    ? { ok: true, orders: result.data }
    : { ok: false, reason: result.reason };
}

export async function getOrderAction(
  orderId: string,
): Promise<OrderActionState> {
  const result = await getOrder(orderId);
  return result.ok
    ? { ok: true, order: result.data }
    : { ok: false, reason: result.reason };
}
