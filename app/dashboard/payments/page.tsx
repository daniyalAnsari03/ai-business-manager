import type { Metadata } from "next";
import { PaymentsView } from "@/components/payments/payments-view";
import { getUserBusiness } from "@/lib/business/service";
import { listPayments } from "@/lib/payments/service";

export const metadata: Metadata = {
  title: "Payments",
};

export const dynamic = "force-dynamic";

/** Payments ledger workspace. */
export default async function PaymentsPage() {
  const business = await getUserBusiness();

  if (!business) {
    return null;
  }

  const result = await listPayments();

  return (
    <PaymentsView
      business={business}
      initialPayments={result.ok ? result.data : []}
      loadFailed={!result.ok}
    />
  );
}
