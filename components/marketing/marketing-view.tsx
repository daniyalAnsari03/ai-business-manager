"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  publishSocialPostAction,
} from "@/app/actions/marketing";
import { Spinner } from "@/components/customers/customer-form-modal";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  MegaPhoneIcon,
  SettingsIcon,
  TrendingUpIcon,
  WalletIcon,
  ZapIcon,
} from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import type { CurrencyCode } from "@/lib/business/constants";
import type { Business } from "@/lib/business/types";
import { formatMoney } from "@/lib/format/currency";
import type { MarketingMetrics } from "@/lib/marketing/types";
import type { ActivityPost } from "@/lib/marketing/social-posts";
import { cn } from "@/lib/utils";
import { EASE_PREMIUM, fadeUp, staggerContainer } from "@/components/motion/presets";

type MarketingViewProps = {
  business: Business;
  metrics: MarketingMetrics | null;
  /** Real social posts (drafts) for the activity feed. */
  initialPosts: ActivityPost[];
  /** True when the initial posts fetch failed — show an honest error. */
  postsLoadFailed: boolean;
  /** True when the server-side fetch failed — show an honest error. */
  loadFailed?: boolean;
};

type AutomationMode = "needsApproval" | "fullAuto";

/**
 * Marketing tab — Phase 1 shell. Metric cards read real values from the new
 * tables (0/empty now, which is correct). The automation toggle is UI-only
 * in this phase: it has no backend behaviour yet (noted in the phase report).
 */
export function MarketingView({
  business,
  metrics,
  initialPosts,
  postsLoadFailed = false,
  loadFailed = false,
}: MarketingViewProps) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const [automationMode, setAutomationMode] = useState<AutomationMode>(
    "needsApproval",
  );
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState<{
    kind: "error" | "info";
    text: string;
  } | null>(null);

  const posts = initialPosts;
  const postsLoadError = postsLoadFailed;

  // Auto-dismiss the publish/not-connected message.
  useEffect(() => {
    if (!publishMessage) return;
    const timer = window.setTimeout(() => setPublishMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [publishMessage]);

  async function handlePublish(post: ActivityPost) {
    setPublishingId(post.id);
    setPublishMessage(null);
    try {
      const result = await publishSocialPostAction(post.id);
      if (result.ok) {
        // Honest "not connected" path — publishing is not faked.
        setPublishMessage({ kind: "info", text: t.marketing.notConnectedMessage });
      } else {
        setPublishMessage({ kind: "error", text: t.marketing.publishFailedMessage });
      }
    } catch {
      setPublishMessage({ kind: "error", text: t.marketing.publishFailedMessage });
    } finally {
      setPublishingId(null);
    }
  }

  if (loadFailed) {
    return (
      <div className="space-y-6">
        <MarketingHeader />
        <Card lift={false} className="flex flex-col items-center py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
            <MegaPhoneIcon className="size-6" />
          </span>
          <h2 className="mt-5 font-display text-2xl font-light">
            {t.marketing.loadError}
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
      </div>
    );
  }

  const postsThisWeek = metrics?.postsThisWeek ?? 0;
  const adSpend = metrics?.adSpend ?? 0;
  const salesFromAds = metrics?.salesFromAds ?? 0;

  const metricCards: Array<{
    icon: React.ReactNode;
    label: string;
    value: string;
  }> = [
    {
      icon: <MegaPhoneIcon className="size-4" />,
      label: t.marketing.postsThisWeekLabel,
      value: postsThisWeek.toLocaleString("en-US"),
    },
    {
      icon: <WalletIcon className="size-4" />,
      label: t.marketing.adSpendLabel,
      value: formatMoney(adSpend, business.currency as CurrencyCode),
    },
    {
      icon: <TrendingUpIcon className="size-4" />,
      label: t.marketing.salesFromAdsLabel,
      value: formatMoney(salesFromAds, business.currency as CurrencyCode),
    },
  ];

  const content = (
    <>
      {/* Real summary — empty/zero right now, which is honest for Phase 1 */}
      <div className="grid gap-4 sm:grid-cols-3">
        {metricCards.map((card) => (
          <MetricCard
            key={card.label}
            icon={card.icon}
            label={card.label}
            value={card.value}
          />
        ))}
      </div>

      {/* Automation mode — UI present, functional wiring arrives in a later
          phase (2/5). No backend behaviour is attached to this toggle yet. */}
      <Card lift={false} className="relative overflow-hidden !p-6">
        <div aria-hidden className="ambient-glow -right-16 -top-24 size-[260px]" />
        <div className="relative">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-accent">
              <ZapIcon className="size-[18px]" />
            </span>
            <div>
              <h2 className="text-sm font-medium uppercase tracking-widest text-faint">
                {t.marketing.automationLabel}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                {t.marketing.automationHint}
              </p>
            </div>
          </div>

          <div
            role="radiogroup"
            aria-label={t.marketing.automationLabel}
            className="mt-5 grid max-w-lg grid-cols-2 gap-3"
          >
            {(
              [
                ["needsApproval", t.marketing.automationNeedsApproval, t.marketing.automationNeedsApprovalHint],
                ["fullAuto", t.marketing.automationFullAuto, t.marketing.automationFullAutoHint],
              ] as Array<[AutomationMode, string, string]>
            ).map(([mode, label, hint]) => {
              const selected = automationMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAutomationMode(mode)}
                  className={
                    selected
                      ? "rounded-xl border border-emerald-500/50 bg-emerald-500/[0.1] p-4 text-left transition-colors"
                      : "rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-emerald-500/30"
                  }
                >
                  <span
                    className={
                      selected
                        ? "block text-sm font-medium text-accent"
                        : "block text-sm font-medium text-foreground"
                    }
                  >
                    {label}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">
                    {hint}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-4 text-xs leading-relaxed text-faint">
            {t.marketing.automationNote}
          </p>
        </div>
      </Card>

      {/* Activity — shows real post drafts; falls back to an honest empty state */}
      <section aria-labelledby="marketing-activity-title">
        <Card lift={false} className="relative overflow-hidden">
          <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
          <div className="relative">
            <h2
              id="marketing-activity-title"
              className="text-sm font-medium uppercase tracking-widest text-faint"
            >
              {t.marketing.activityTitle}
            </h2>

            {postsLoadError ? (
              <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                {t.marketing.activityLoadError}
              </div>
            ) : posts.length > 0 ? (
              <ul className="mt-5 space-y-3">
                {posts.map((post) => (
                  <li key={post.id}>
                    <ActivityPostCard
                      post={post}
                      publishing={publishingId === post.id}
                      onPublish={() => handlePublish(post)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center py-12 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
                  <MegaPhoneIcon className="size-6" />
                </span>
                <h3 className="mt-5 font-display text-2xl font-light">
                  {t.marketing.activityEmptyTitle}
                </h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
                  {t.marketing.activityEmptyBody}
                </p>
                <Link href="/dashboard/settings" className="mt-7">
                  <Button size="lg" variant="secondary">
                    <SettingsIcon className="size-[18px]" />
                    {t.marketing.activityAction}
                  </Button>
                </Link>
              </div>
            )}

            {/* Publish / not-connected feedback */}
            <AnimatePresence>
              {publishMessage ? (
                <motion.p
                  role="status"
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reducedMotion ? undefined : { opacity: 0 }}
                  transition={{ duration: 0.25, ease: EASE_PREMIUM }}
                  className={cn(
                    "mt-4 flex items-start gap-1.5 text-sm leading-relaxed",
                    publishMessage.kind === "error"
                      ? "text-muted"
                      : "font-medium text-emerald-700 dark:text-emerald-300",
                  )}
                >
                  {publishMessage.kind === "error" ? (
                    <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <CheckCircleIcon className="mt-0.5 size-4 shrink-0" />
                  )}
                  {publishMessage.text}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>
        </Card>
      </section>
    </>
  );

  return (
    <div className="space-y-6">
      <MarketingHeader />
      {reducedMotion ? (
        content
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {content}
        </motion.div>
      )}
    </div>
  );
}

function MarketingHeader() {
  const { t } = useI18n();
  return (
    <PageHeader
      eyebrow={
        <>
          <MegaPhoneIcon className="size-3.5" />
          {t.nav.marketing}
        </>
      }
      title={t.marketing.title}
      subtitle={t.marketing.subtitle}
    />
  );
}

function ActivityPostCard({
  post,
  publishing,
  onPublish,
}: {
  post: ActivityPost;
  publishing: boolean;
  onPublish: () => void;
}) {
  const { t } = useI18n();
  const captionPreview = post.caption ? post.caption.slice(0, 160) : "";
  const draft = post.status === "draft";

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {post.productName ?? t.marketing.activityTitle}
          </p>
          <p className="mt-0.5 text-xs text-faint">
            {draft ? t.marketing.postDraftStatus : null}
          </p>
        </div>
        {draft ? (
          <Button
            size="md"
            variant="secondary"
            disabled={publishing}
            onClick={onPublish}
          >
            {publishing ? (
              <>
                <Spinner />
                {t.marketing.publishingButton}
              </>
            ) : (
              t.marketing.publishButton
            )}
          </Button>
        ) : null}
      </div>
      {captionPreview ? (
        <p className="mt-2.5 text-sm leading-relaxed text-muted">
          {captionPreview}
          {post.caption && post.caption.length > 160 ? "…" : ""}
        </p>
      ) : null}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const reducedMotion = useReducedMotion();
  const card = (
    <Card lift={false} className="flex items-center gap-4 !p-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-accent">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs uppercase tracking-widest text-faint">
          {label}
        </p>
        <p className="truncate font-display text-2xl font-light tabular-nums leading-tight">
          {value}
        </p>
      </div>
    </Card>
  );
  if (reducedMotion) return card;
  return (
    <motion.div
      variants={fadeUp}
      transition={{ duration: 0.7, ease: EASE_PREMIUM }}
    >
      {card}
    </motion.div>
  );
}