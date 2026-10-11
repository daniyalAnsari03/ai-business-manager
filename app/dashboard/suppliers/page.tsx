import type { Metadata } from "next";
import { SuppliersView } from "@/components/suppliers/suppliers-view";
import { getUserBusiness } from "@/lib/business/service";
import { getSupplierBills } from "@/lib/supplier-bills/service";
import { getSuppliers } from "@/lib/suppliers/service";

export const metadata: Metadata = {
  title: "Suppliers",
};

export const dynamic = "force-dynamic";

/**
 * Suppliers workspace. Bills load alongside suppliers so each supplier's
 * detail view and owing figures are real from the first render.
 */
export default async function SuppliersPage() {
  const business = await getUserBusiness();

  if (!business) {
    return null;
  }

  const [suppliersResult, billsResult] = await Promise.all([
    getSuppliers(),
    getSupplierBills(),
  ]);

  return (
    <SuppliersView
      business={business}
      initialSuppliers={suppliersResult.ok ? suppliersResult.data : []}
      initialBills={billsResult.ok ? billsResult.data : []}
      loadFailed={!suppliersResult.ok}
    />
  );
}
