"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import {
  approveActionAction,
  listApprovalHistoryAction,
  listReviewableActionsAction,
  rejectActionAction,
} from "@/app/actions/approvals";
import { Spinner } from "@/components/customers/customer-form-modal";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  MegaPhoneIcon,
  ShieldCheckIcon,
} from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import type {
  ApprovalAction,
  ReviewableAction,
} from "@/lib/marketing/approval-types";
import { cn } from "@/lib/utils";

type ApprovalsViewProps = {
  initialPending: ReviewableAction[];
  initialHistory: ApprovalAction[];
  loadFailed?: boolean;
};

type Feedback =
  | { kind: "info"; text: string }
  | { kind: "error"; text: string }
  | null;

/**
 * In-app review system (Phase 4). Shows pending AI actions the owner must
 * approve or reject, plus the real approval history. Every action is read
 * from approval_actions — nothing is fabricated.
 */
export function ApprovalsView({
  initialPending,
  initialHistory,
  loadFailed = false,
}: ApprovalsViewProps) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();

  const [pending, setPending] = useState<ReviewableAction[]>(initialPending);
  const [history, setHistory] = useState<ApprovalAction[]>(initialHistory);
  const [selected, setSelected] = useState<ReviewableAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function refresh() {
    const [p, h] = await Promise.all([
      listReviewableActionsAction(),
      listApprovalHistoryAction(20),
    ]);
    if (p.ok) setPending(p.actions);
    if (h.ok) setHistory(h.actions);
  }

  function closeModal() {
    setSelected(null);
    setConfirmReject(false);
  }

  async function handleApprove(action: ReviewableAction) {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await approveActionAction(action.id);
      if (result.ok) {
        setFeedback({ kind: "info", text: t.marketing.approvalsApproveSuccess });
        closeModal();
        await refresh();
      } else {
        setFeedback({ kind: "error", text: mapError(result.reason, t) });
      }
    } catch {
      setFeedback({ kind: "error", text: t.marketing.approvalsGenericError });
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(action: ReviewableAction) {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await rejectActionAction(action.id);
      if (result.ok) {
        setFeedback({ kind: "info", text: t.marketing.approvalsRejectSuccess });
        closeModal();
        await refresh();
      } else {
        setFeedback({ kind: "error", text: mapError(result.reason, t) });
      }
    } catch {
      setFeedback({ kind: "error", text: t.marketing.approvalsGenericError });
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <>
      {feedback ? (
        <p
          role="status"
          className={cn(
            "flex items-start gap-1.5 text-sm leading-relaxed",
            feedback.kind === "error"
              ? "text-muted"
              : "font-medium text-emerald-700 dark:text-emerald-300",
          )}
        >
          {feedback.kind === "error" ? (
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          ) : (
            <CheckCircleIcon className="mt-0.5 size-4 shrink-0" />
          )}
          {feedback.text}
        </p>
      ) : null}

      {/* Pending review */}
      <section aria-labelledby="approvals-pending-title">
        <Card lift={false} className="relative overflow-hidden">
          <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
          <div className="relative">
            <h2
              id="approvals-pending-title"
              className="text-sm font-medium uppercase tracking-widest text-faint"
            >
              {t.marketing.approvalsNeedsTitle}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {t.marketing.approvalsNeedsSubtitle}
            </p>

            {pending.length > 0 ? (
              <ul className="mt-5 space-y-3">
                {pending.map((action) => (
                  <li key={action.id}>
                    <PendingCard
                      action={action}
                      onReview={() => {
                        setConfirmReject(false);
                        setSelected(action);
                      }}
                      busy={busy}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center py-12 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
                  <ShieldCheckIcon className="size-6" />
                </span>
                <h3 className="mt-5 font-display text-2xl font-light">
                  {t.marketing.approvalsEmptyTitle}
                </h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
                  {t.marketing.approvalsEmptyBody}
                </p>
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* History */}
      <section aria-labelledby="approvals-history-title">
        <Card lift={false} className="relative overflow-hidden">
          <div className="relative">
            <h2
              id="approvals-history-title"
              className="text-sm font-medium uppercase tracking-widest text-faint"
            >
              {t.marketing.approvalsHistoryTitle}
            </h2>

            {history.length > 0 ? (
              <ul className="mt-4 divide-y divide-line">
                {history.map((item) => (
                  <HistoryRow key={item.id} item={item} tKey={t.marketing} />
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-muted">
                {t.marketing.approvalsHistoryEmpty}
              </p>
            )}
          </div>
        </Card>
      </section>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <ShieldCheckIcon className="size-3.5" />
            {t.marketing.approvalsNav}
          </>
        }
        title={t.marketing.title}
        subtitle={t.marketing.approvalsNeedsSubtitle}
      />

      {loadFailed ? (
        <Card lift={false} className="flex flex-col items-center py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
            <MegaPhoneIcon className="size-6" />
          </span>
          <h2 className="mt-5 font-display text-2xl font-light">
            {t.marketing.approvalsLoadError}
          </h2>
          <Button
            variant="secondary"
            size="lg"
            className="mt-7"
            onClick={() => window.location.reload()}
          >
            {t.common.tryAgain}
          </Button>
        </Card>
      ) : reducedMotion ? (
        content
      ) : (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          {content}
        </motion.div>
      )}

      {/* Review modal */}
      <AnimatePresence>
        {selected ? (
          <Modal
            open
            onClose={closeModal}
            title={t.marketing.reviewScreenTitle}
            description={selected.summary}
            size="lg"
          >
            <dl className="space-y-4 text-sm">
              <ReviewDetail
                label={t.marketing.reviewPlatform}
                value={selected.platform ?? "—"}
              />
              {selected.productName ? (
                <ReviewDetail
                  label={t.marketing.reviewContent}
                  value={selected.productName}
                />
              ) : null}
              {selected.scheduledAt ? (
                <ReviewDetail
                  label={t.marketing.reviewTiming}
                  value={formatTime(selected.scheduledAt)}
                />
              ) : null}
              <ReviewDetail
                label={t.marketing.reviewApprovalMode}
                value={
                  selected.hasExpired
                    ? t.marketing.approvalStatusExpired
                    : t.marketing.approvalModeNeedsApproval
                }
              />
              {selected.hasExpired ? (
                <p className="flex items-center gap-1.5 text-sm text-muted">
                  <ClockIcon className="size-4 shrink-0" />
                  {t.marketing.approvalsErrorExpired}
                </p>
              ) : null}
            </dl>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                className="flex-1"
                disabled={busy || selected.hasExpired}
                onClick={() => handleApprove(selected)}
              >
                {busy ? <Spinner /> : null}
                {t.marketing.approveButton}
              </Button>
              {confirmReject ? (
                <Button
                  variant="secondary"
                  size="lg"
                  className="flex-1"
                  disabled={busy || selected.hasExpired}
                  onClick={() => handleReject(selected)}
                >
                  {busy ? <Spinner /> : null}
                  {t.marketing.rejectButton}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="lg"
                  className="flex-1"
                  disabled={selected.hasExpired}
                  onClick={() => setConfirmReject(true)}
                >
                  {t.marketing.rejectButton}
                </Button>
              )}
            </div>
            {confirmReject ? (
              <p className="mt-3 text-xs text-muted">
                {t.marketing.rejectButton} — {t.marketing.approvalsRejectSuccess}
              </p>
            ) : null}
          </Modal>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ReviewDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-widest text-faint">{label}</dt>
      <dd className="leading-relaxed text-foreground">{value}</dd>
    </div>
  );
}

function PendingCard({
  action,
  onReview,
  busy,
}: {
  action: ReviewableAction;
  onReview: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{action.summary}</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-faint">
          {action.hasExpired ? (
            <>
              <ClockIcon className="size-3.5" />
              {t.marketing.approvalStatusExpired}
            </>
          ) : (
            <>
              <ClockIcon className="size-3.5" />
              {formatTime(action.createdAt)}
            </>
          )}
          {action.platform ? (
            <span className="ml-1 rounded-full border border-line px-2 py-0.5">
              {action.platform}
            </span>
          ) : null}
        </p>
      </div>
      <Button
        size="md"
        variant="secondary"
        disabled={busy || action.hasExpired}
        onClick={onReview}
      >
        {t.common.view}
      </Button>
    </div>
  );
}

function HistoryRow({
  item,
  tKey,
}: {
  item: ApprovalAction;
  tKey: { [k: string]: string };
}) {
  const payload = item.actionPayload as Record<string, unknown>;
  const productName = typeof payload.productName === "string" ? payload.productName : null;
  const platform = typeof payload.platform === "string" ? payload.platform : null;
  const failureReason = item.executionError ?? null;

  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{item.summary}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-faint">
          {productName ? (
            <span className="rounded-full border border-line px-2 py-0.5">{productName}</span>
          ) : null}
          {platform ? (
            <span className="rounded-full border border-line px-2 py-0.5 capitalize">{platform}</span>
          ) : null}
          <span>{formatTime(item.createdAt)}</span>
        </div>
        {failureReason && (item.status === "failed" || item.status === "rejected") ? (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{failureReason}</p>
        ) : null}
      </div>
      <StatusPill status={item.status} tKey={tKey} />
    </li>
  );
}

function StatusPill({
  status,
  tKey,
}: {
  status: ApprovalAction["status"];
  tKey: { [k: string]: string };
}) {
  const label = tKey[`approvalStatus${capitalize(status)}`] ?? status;
  const styles =
    status === "completed" || status === "approved"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "rejected" || status === "cancelled" || status === "failed"
        ? "bg-red-500/10 text-red-700 dark:text-red-300"
        : status === "expired"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "bg-muted/10 text-muted";
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-medium capitalize",
        styles,
      )}
    >
      {label}
    </span>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type ApprovalErrorReason =
  | "unauthorized"
  | "not_pending"
  | "expired"
  | "duplicate"
  | "execution_failed"
  | "database_error"
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "not_found";

function mapError(reason: ApprovalErrorReason, t: {
  marketing: {
    approvalsErrorUnauthorized: string;
    approvalsErrorNotPending: string;
    approvalsErrorExpired: string;
    approvalsErrorDuplicate: string;
    approvalsErrorExecution: string;
    approvalsGenericError: string;
  };
}): string {
  switch (reason) {
    case "unauthorized":
    case "no_business":
    case "not_found":
      return t.marketing.approvalsErrorUnauthorized;
    case "not_pending":
      return t.marketing.approvalsErrorNotPending;
    case "expired":
      return t.marketing.approvalsErrorExpired;
    case "duplicate":
      return t.marketing.approvalsErrorDuplicate;
    case "execution_failed":
      return t.marketing.approvalsErrorExecution;
    default:
      return t.marketing.approvalsGenericError;
  }
}
