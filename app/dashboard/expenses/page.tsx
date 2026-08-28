import type { Metadata } from "next";
import { ExpensesView } from "@/components/expenses/expenses-view";
import { getUserBusiness } from "@/lib/business/service";
import { getExpenses } from "@/lib/expenses/service";

export const metadata: Metadata = {
  title: "Expenses",
};

export const dynamic = "force-dynamic";

/** Real expense records for the authenticated business only. */
export default async function ExpensesPage() {
  const business = await getUserBusiness();

  if (!business) {
    // The layout already gates this case; kept as a safe fallback.
    return null;
  }

  const result = await getExpenses();

  return (
    <ExpensesView
      currency={business.currency}
      initialExpenses={result.ok ? result.data : []}
      loadFailed={!result.ok}
    />
  );
}
