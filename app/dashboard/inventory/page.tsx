import type { Metadata } from "next";
import { InventoryView } from "@/components/inventory/inventory-view";
import { getUserBusiness } from "@/lib/business/service";
import { getProducts } from "@/lib/products/service";

export const metadata: Metadata = {
  title: "Inventory",
};

export const dynamic = "force-dynamic";

/** Live stock levels for the authenticated business's active products. */
export default async function InventoryPage() {
  const business = await getUserBusiness();

  if (!business) {
    // The layout already gates this case; kept as a safe fallback.
    return null;
  }

  const result = await getProducts();

  return (
    <InventoryView
      initialProducts={result.ok ? result.data : []}
      loadFailed={!result.ok}
    />
  );
}
