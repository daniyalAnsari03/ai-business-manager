import type { Metadata } from "next";
import { OrdersView } from "@/components/orders/orders-view";
import { getUserBusiness } from "@/lib/business/service";
import { getCustomers } from "@/lib/customers/service";
import { getOrders } from "@/lib/orders/service";
import { getProducts } from "@/lib/products/service";

export const metadata: Metadata = {
  title: "Orders",
};

export const dynamic = "force-dynamic";

/**
 * Orders workspace. Products and customers load alongside orders so the
 * create-order dialog has real references to pick from.
 */
export default async function OrdersPage() {
  const business = await getUserBusiness();

  if (!business) {
    // The layout already gates this case; kept as a safe fallback.
    return null;
  }

  const [ordersResult, productsResult, customersResult] = await Promise.all([
    getOrders(),
    getProducts(),
    getCustomers(),
  ]);

  return (
    <OrdersView
      business={business}
      initialOrders={ordersResult.ok ? ordersResult.data : []}
      products={productsResult.ok ? productsResult.data : []}
      customers={
        customersResult.ok
          ? customersResult.data.map((customer) => ({
              id: customer.id,
              name: customer.name,
            }))
          : []
      }
      loadFailed={!ordersResult.ok}
    />
  );
}
