import type { Metadata } from "next";
import { AiChat } from "@/components/ai/ai-chat";
import { getUserBusiness } from "@/lib/business/service";

export const metadata: Metadata = {
  title: "AI Manager",
};

export const dynamic = "force-dynamic";

/**
 * AI Manager workspace. Data access happens exclusively inside the
 * server-side agent tools; this page only renders the client chat surface.
 */
export default async function AssistantPage() {
  // Consistent with the other module pages: gate on an existing business.
  const business = await getUserBusiness();
  if (!business) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AiChat />
    </div>
  );
}
