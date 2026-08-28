/** Order domain types shared by the service layer, server actions and UI. */

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "processing",
  "completed",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export interface OrderItem {
  id: string;
  orderId: string;
  businessId: string;
  productId: string | null;
  /** Sale-time snapshot — stays correct even if the product changes later. */
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  businessId: string;
  customerId: string | null;
  orderNumber: string;
  status: OrderStatus;
  subtotal: number;
  discount: number;
  total: number;
  notes: string | null;
  orderedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type OrderWithItems = Order & { items: OrderItem[] };

export interface OrderInput {
  customerId: string | null;
  discount: number;
  notes: string | null;
  orderedAt: string | null;
  /** Creation status. Defaults to "pending" when omitted; "completed" records a
   *  sale and deducts stock atomically at creation (docs/fix.txt). */
  status?: "pending" | "completed";
  items: Array<{ productId: string; quantity: number }>;
}

export function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
