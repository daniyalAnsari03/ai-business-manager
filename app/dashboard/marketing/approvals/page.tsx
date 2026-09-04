import type { Metadata } from "next";
import { ApprovalsView } from "@/components/marketing/approvals-view";
import {
  listApprovalHistory,
  listReviewableActions,
} from "@/lib/marketing/approval-service";

export const metadata: Metadata = {
  title: "Approvals",
};

export const dynamic = "force-dynamic";

/**
 * Approvals page — shows real pending AI actions for in-app review plus the
 * full approval history. Every row comes from the approval_actions table; no
 * data is fabricated.
 */
export default async function ApprovalsPage() {
  const [reviewableResult, historyResult] = await Promise.all([
    listReviewableActions(),
    listApprovalHistory(20),
  ]);

  return (
    <ApprovalsView
      initialPending={reviewableResult.ok ? reviewableResult.data : []}
      initialHistory={historyResult.ok ? historyResult.data : []}
      loadFailed={!reviewableResult.ok || !historyResult.ok}
    />
  );
}
