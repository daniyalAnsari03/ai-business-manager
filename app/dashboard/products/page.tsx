import type { Metadata } from "next";
import { ProductsView } from "@/components/products/products-view";
import { getUserBusiness } from "@/lib/business/service";
import { getProducts } from "@/lib/products/service";

export const metadata: Metadata = {
  title: "Products",
};

export const dynamic = "force-dynamic";

/** Real products from Supabase, isolated by the authenticated business. */
export default async function ProductsPage() {
  const business = await getUserBusiness();

  if (!business) {
    // The layout already gates this case; kept as a safe fallback.
    return null;
  }

  const result = await getProducts();

  return (
    <ProductsView
      business={business}
      initialProducts={result.ok ? result.data : []}
      loadFailed={!result.ok}
    />
  );
}
