import { serviceState } from "./service-state.mjs";

function findOrder(orderId) {
  return (serviceState.orders.data ?? []).find((o) => o.id === orderId) ?? null;
}

// Deterministic stand-ins for the order service functions the audited tools
// call. createOrder prices from the product fixture, exactly like the real
// service does, so the audit snapshot is built from realistic data.
export async function getOrders() {
  return serviceState.orders;
}

export async function createOrder(input) {
  if (serviceState.createOrderResult) return serviceState.createOrderResult;
  const products = serviceState.products.data ?? [];
  const items = (input.items ?? []).map((item, index) => {
    const product = products.find((p) => p.id === item.productId) ?? null;
    const unitPrice = product?.price ?? 0;
    return {
      id: `order-item-${index + 1}`,
      orderId: "order-201",
      businessId: product?.businessId ?? "biz",
      productId: item.productId,
      productName: product?.name ?? "unknown",
      unitPrice,
      quantity: item.quantity,
      lineTotal: unitPrice * item.quantity,
    };
  });
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const discount = input.discount ?? 0;
  return {
    ok: true,
    data: {
      id: "order-201",
      businessId: "biz",
      customerId: input.customerId,
      orderNumber: "ORD-201",
      status: input.status ?? "pending",
      subtotal,
      discount,
      total: subtotal - discount,
      notes: input.notes ?? null,
      orderedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      items,
    },
  };
}

export async function updateOrderStatus(orderId, status) {
  if (serviceState.updateOrderStatusResult) return serviceState.updateOrderStatusResult;
  const order = findOrder(orderId);
  if (!order) return { ok: false, reason: "not_found" };
  return { ok: true, data: { ...order, status } };
}

// Not used by the audited tools, but imported by the customer tool module.
export async function getOrdersByCustomer() {
  return { ok: true, data: [] };
}
