import type { Metadata } from "next";
import { CustomersView } from "@/components/customers/customers-view";
import { getUserBusiness } from "@/lib/business/service";
import { getCustomers } from "@/lib/customers/service";

export const metadata: Metadata = {
  title: "Customers",
};

export const dynamic = "force-dynamic";

/** Real customers from Supabase, isolated by the authenticated business. */
export default async function CustomersPage() {
  const business = await getUserBusiness();

  if (!business) {
    // The layout already gates this case; kept as a safe fallback.
    return null;
  }

  const result = await getCustomers();

  return (
    <CustomersView
      business={business}
      initialCustomers={result.ok ? result.data : []}
      loadFailed={!result.ok}
    />
  );
}
