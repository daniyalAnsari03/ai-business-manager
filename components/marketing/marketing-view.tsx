"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  listSocialPostsAction,
  publishSocialPostAction,
  regeneratePostAction,
  updatePostLanguageAction,
} from "@/app/actions/marketing";
import { Spinner } from "@/components/customers/customer-form-modal";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ImageIcon,
  MegaPhoneIcon,
  RefreshCwIcon,
  SettingsIcon,
  ShieldCheckIcon,
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
import type { WalletTransaction } from "@/lib/marketing/types";
import { cn } from "@/lib/utils";
import { EASE_PREMIUM, fadeUp, staggerContainer } from "@/components/motion/presets";
import { WalletSection } from "@/components/marketing/wallet-section";
import { setAutomationModeAction } from "@/app/actions/automation";

type MarketingViewProps = {
  business: Business;
  metrics: MarketingMetrics | null;
  /** Real social posts (drafts) for the activity feed. */
  initialPosts: ActivityPost[];
  /** True when the initial posts fetch failed — show an honest error. */
  postsLoadFailed: boolean;
  /** True when the server-side fetch failed — show an honest error. */
  loadFailed?: boolean;
  /** Wallet balance read from the real marketing_wallet table. */
  initialWalletBalance: number;
  /** Monthly ad budget cap from the wallet, or null. */
  initialWalletMonthlyBudgetCap: number | null;
  /** Real wallet_transactions ledger rows. */
  initialWalletTransactions: WalletTransaction[];
  /** Whether the server-side wallet load failed. */
  walletLoadFailed?: boolean;
  /** Whether a real payment provider is configured. */
  paymentProviderAvailable: boolean;
  /** Whether to show the debug test-spend tool. */
  showTestSpend?: boolean;
  /** The business's persisted automation mode (needs_approval | full_auto). */
  initialAutomationMode?: "needs_approval" | "full_auto";
  /** True when the automation mode could not be loaded server-side. */
  automationLoadFailed?: boolean;
};

type AutomationMode = "needsApproval" | "fullAuto";

/**
 * Marketing tab — Phase 1 shell + Phase 4. Metric cards read real values from
 * the new tables (0/empty now, which is correct). The automation mode is now
 * FULLY functional (Phase 4): it persists to Supabase and governs whether the
 * AI Manager needs approval before publishing/spending.
 */
export function MarketingView({
  business,
  metrics,
  initialPosts,
  postsLoadFailed = false,
  loadFailed = false,
  initialWalletBalance,
  initialWalletMonthlyBudgetCap,
  initialWalletTransactions,
  walletLoadFailed = false,
  paymentProviderAvailable,
  showTestSpend = false,
  initialAutomationMode = "needs_approval",
  automationLoadFailed = false,
}: MarketingViewProps) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const [automationMode, setAutomationMode] = useState<AutomationMode>(
    initialAutomationMode === "full_auto" ? "fullAuto" : "needsApproval",
  );
  const [automationSaving, setAutomationSaving] = useState(false);
  const [automationSaveError, setAutomationSaveError] = useState(false);
  const [posts, setPosts] = useState<ActivityPost[]>(initialPosts);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState<{
    kind: "error" | "info" | "success";
    text: string;
  } | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [regenerateMessage, setRegenerateMessage] = useState<{
    kind: "error" | "info";
    text: string;
  } | null>(null);

  const postsLoadError = postsLoadFailed;

  // Auto-dismiss the publish/not-connected message.
  useEffect(() => {
    if (!publishMessage) return;
    const timer = window.setTimeout(() => setPublishMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [publishMessage]);

  // Auto-dismiss the regenerate message.
  useEffect(() => {
    if (!regenerateMessage) return;
    const timer = window.setTimeout(() => setRegenerateMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [regenerateMessage]);

  async function handlePublish(post: ActivityPost) {
    setPublishingId(post.id);
    setPublishMessage(null);
    try {
      const result = await publishSocialPostAction(post.id);
      if (result.ok) {
        if (result.published) {
          // Real publish succeeded — update the post in local state.
          setPosts((prev) =>
            prev.map((p) =>
              p.id === post.id
                ? { ...p, status: "published" as const, publishedAt: new Date().toISOString() }
                : p,
            ),
          );
          setPublishMessage({
            kind: "success",
            text:
              result.platform === "facebook"
                ? t.marketing.publishSuccessMessageFb
                : t.marketing.publishSuccessMessage,
          });
        } else {
          // Honest specific failure — map code to the correct message using
          // the platform that was actually attempted (the router resolves it
          // from the connected account, which may differ from the draft's
          // legacy platform label).
          const isFacebook = result.platform === "facebook";
          const messageMap: Record<string, string> = {
            not_connected: t.marketing.notConnectedMessage,
            token_expired: isFacebook
              ? t.marketing.tokenExpiredMessageFb
              : t.marketing.tokenExpiredMessage,
            no_media: t.marketing.noMediaMessage,
            not_draft: t.marketing.publishFailedMessage,
            publish_failed: t.marketing.publishFailedMessage,
            not_found: t.marketing.publishFailedMessage,
          };
          setPublishMessage({
            kind: "error",
            text: messageMap[result.code] ?? t.marketing.publishFailedMessage,
          });
        }
      } else {
        setPublishMessage({ kind: "error", text: t.marketing.publishFailedMessage });
      }
    } catch {
      setPublishMessage({ kind: "error", text: t.marketing.publishFailedMessage });
    } finally {
      setPublishingId(null);
    }
  }

  async function handleRegenerate(post: ActivityPost) {
    setRegeneratingId(post.id);
    setRegenerateMessage(null);
    try {
      const result = await regeneratePostAction(post.id);
      if (result.ok) {
        // Replace the post in local state with the updated version.
        setPosts((prev) =>
          prev.map((p) => (p.id === result.post.id ? result.post : p)),
        );
      } else {
        setRegenerateMessage({ kind: "error", text: t.marketing.regenerateFailedMessage });
      }
    } catch {
      setRegenerateMessage({ kind: "error", text: t.marketing.regenerateFailedMessage });
    } finally {
      setRegeneratingId(null);
    }
  }

  async function handleLanguageToggle(post: ActivityPost, language: "en" | "ur") {
    // Optimistic local update: swap the displayed caption immediately.
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== post.id) return p;
        const caption = language === "ur" ? p.captionUr : p.captionEn;
        return { ...p, selectedLanguage: language, caption };
      }),
    );
    // Persist to server (best-effort — no loading state for a fast toggle).
    try {
      await updatePostLanguageAction(post.id, language);
    } catch {
      // Silently fail — the local state is already updated for responsive UX.
      // The next refresh will re-sync from the server.
    }
  }

  /**
   * Re-reads the activity feed from the server. This is the escape hatch for
   * the honest "I created/backfilled posts elsewhere but the open tab hasn't
   * re-rendered" case: the feed is otherwise server-rendered from the page
   * props, so without this a backfill (docs/phase0.txt) run in another request
   * stays invisible until a full reload.
   */
  async function handleRefresh() {
    setRefreshing(true);
    setRefreshFailed(false);
    try {
      const result = await listSocialPostsAction();
      if (result.ok) {
        setPosts(result.posts);
      } else {
        setRefreshFailed(true);
      }
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  }

  /**
   * Persists the automation mode through the guarded server action so it is
   * stored in Supabase (not localStorage). The UI reflects the optimistic
   * choice immediately; a save failure is surfaced honestly.
   */
  async function handleAutomationChange(mode: AutomationMode) {
    setAutomationMode(mode);
    setAutomationSaveError(false);
    setAutomationSaving(true);
    try {
      const result = await setAutomationModeAction(
        mode === "fullAuto" ? "full_auto" : "needs_approval",
      );
      if (!result.ok) setAutomationSaveError(true);
    } catch {
      setAutomationSaveError(true);
    } finally {
      setAutomationSaving(false);
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
      {/* Phase 4 — Approvals + Video sub-navigation */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/dashboard/marketing/approvals">
          <Card lift className="relative flex items-center gap-3 !p-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-accent">
              <ShieldCheckIcon className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{t.marketing.approvalsNav}</p>
              <p className="mt-0.5 truncate text-xs text-faint">
                {t.marketing.approvalsNeedsSubtitle}
              </p>
            </div>
          </Card>
        </Link>
        <Link href="/dashboard/marketing/video">
          <Card lift className="relative flex items-center gap-3 !p-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-accent">
              <ImageIcon className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{t.marketing.videoNav}</p>
              <p className="mt-0.5 truncate text-xs text-faint">
                {t.marketing.videoSubtitle}
              </p>
            </div>
          </Card>
        </Link>
      </div>

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

      {/* Wallet dashboard — real balance + transaction ledger */}
      <WalletSection
        business={business}
        initialBalance={initialWalletBalance}
        monthlyBudgetCap={initialWalletMonthlyBudgetCap}
        initialTransactions={initialWalletTransactions}
        paymentProviderAvailable={paymentProviderAvailable}
        walletLoadFailed={walletLoadFailed}
        showTestSpend={showTestSpend}
      />

      {/* Automation mode — Phase 4: persists to Supabase and governs whether
          the AI Manager needs approval before publishing/spending. */}
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
            className="mt-5 grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-2"
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
                  onClick={() => handleAutomationChange(mode)}
                  disabled={automationSaving}
                  className={
                    selected
                      ? "rounded-xl border border-emerald-500/50 bg-emerald-500/[0.1] p-4 text-left transition-colors"
                      : "rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-emerald-500/30 disabled:opacity-60"
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

          {automationLoadFailed ? (
            <p className="mt-4 flex items-center gap-1.5 text-xs leading-relaxed text-muted">
              <AlertTriangleIcon className="size-3.5 shrink-0" />
              {t.marketing.approvalsGenericError}
            </p>
          ) : automationSaveError ? (
            <p className="mt-4 flex items-center gap-1.5 text-xs leading-relaxed text-muted">
              <AlertTriangleIcon className="size-3.5 shrink-0" />
              {t.marketing.automationSaveFailed}
            </p>
          ) : automationSaving ? (
            <p className="mt-4 flex items-center gap-1.5 text-xs leading-relaxed text-muted">
              <Spinner />
              {t.common.loading}
            </p>
          ) : (
            <p className="mt-4 text-xs leading-relaxed text-faint">
              {automationMode === "fullAuto"
                ? t.marketing.automationFullAutoHint
                : t.marketing.automationNeedsApprovalHint}
            </p>
          )}
        </div>
      </Card>

      {/* Activity — shows real post drafts; falls back to an honest empty state */}
      <section aria-labelledby="marketing-activity-title">
        <Card lift={false} className="relative overflow-hidden">
          <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="marketing-activity-title"
                className="text-sm font-medium uppercase tracking-widest text-faint"
              >
                {t.marketing.activityTitle}
              </h2>
              <Button
                size="md"
                variant="ghost"
                className="min-h-9 px-3 text-xs"
                disabled={refreshing}
                onClick={handleRefresh}
                aria-label={t.marketing.activityRefresh}
              >
                <RefreshCwIcon className="size-3.5" />
                {refreshing
                  ? t.marketing.activityRefreshing
                  : t.marketing.activityRefresh}
              </Button>
            </div>

            {postsLoadError ? (
              <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                {t.marketing.activityLoadError}
              </div>
            ) : (
              <>
                {refreshFailed ? (
                  <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted">
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                    {t.marketing.activityLoadError}
                  </div>
                ) : null}
                {posts.length > 0 ? (
                  <ul className="mt-5 space-y-3">
                    {posts.map((post) => (
                      <li key={post.id}>
                        <ActivityPostCard
                          post={post}
                          publishing={publishingId === post.id}
                          onPublish={() => handlePublish(post)}
                          regenerating={regeneratingId === post.id}
                          onRegenerate={() => handleRegenerate(post)}
                          onLanguageToggle={(lang) => handleLanguageToggle(post, lang)}
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
              </>
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

            {/* Regenerate feedback */}
            <AnimatePresence>
              {regenerateMessage ? (
                <motion.p
                  role="status"
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reducedMotion ? undefined : { opacity: 0 }}
                  transition={{ duration: 0.25, ease: EASE_PREMIUM }}
                  className={cn(
                    "mt-4 flex items-start gap-1.5 text-sm leading-relaxed",
                    regenerateMessage.kind === "error"
                      ? "text-muted"
                      : "font-medium text-emerald-700 dark:text-emerald-300",
                  )}
                >
                  {regenerateMessage.kind === "error" ? (
                    <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <CheckCircleIcon className="mt-0.5 size-4 shrink-0" />
                  )}
                  {regenerateMessage.text}
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
  regenerating,
  onRegenerate,
  onLanguageToggle,
}: {
  post: ActivityPost;
  publishing: boolean;
  onPublish: () => void;
  regenerating: boolean;
  onRegenerate: () => void;
  onLanguageToggle: (lang: "en" | "ur") => void;
}) {
  const { t } = useI18n();
  const draft = post.status === "draft";

  // Local toggle state: which language is displayed on THIS card only.
  const [displayLang, setDisplayLang] = useState<"en" | "ur">(post.selectedLanguage);
  const captionPreview = (() => {
    const caption = displayLang === "ur" ? post.captionUr : post.captionEn;
    return caption ? caption.slice(0, 160) : "";
  })();
  const fullCaption = displayLang === "ur" ? post.captionUr : post.captionEn;

  function handleToggle(lang: "en" | "ur") {
    setDisplayLang(lang);
    onLanguageToggle(lang);
  }

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {post.productName ?? t.marketing.activityTitle}
          </p>
          <p className="mt-0.5 text-xs text-faint">
            {draft
              ? t.marketing.postDraftStatus
              : post.status === "published"
                ? t.marketing.postPublishedStatus
                : post.status === "failed"
                  ? t.marketing.postFailedStatus
                  : null}
          </p>
        </div>
        {draft ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              size="md"
              variant="ghost"
              className="min-h-9 px-3 text-xs"
              disabled={regenerating}
              onClick={onRegenerate}
            >
              {regenerating ? (
                <>
                  <Spinner />
                  {t.marketing.regeneratingButton}
                </>
              ) : (
                <>
                  <RefreshCwIcon className="size-3.5" />
                  {t.marketing.regenerateButton}
                </>
              )}
            </Button>
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
          </div>
        ) : null}
      </div>

      {/* Per-draft language toggle — only shown when both captions exist */}
      {draft && (post.captionUr || post.captionEn) ? (
        <div
          role="group"
          aria-label={t.marketing.languageEnglish}
          className="mt-3 inline-flex items-center rounded-full border border-line bg-surface-raised p-0.5"
        >
          {(["en", "ur"] as const).map((lang) => {
            const active = displayLang === lang;
            return (
              <button
                key={lang}
                type="button"
                onClick={() => handleToggle(lang)}
                aria-pressed={active}
                className={cn(
                  "min-h-7 rounded-full px-2.5 text-[11px] font-medium transition-colors duration-200",
                  active
                    ? "bg-emerald-500/15 text-accent"
                    : "text-muted hover:text-foreground",
                )}
              >
                {lang === "en" ? t.marketing.languageEnglish : t.marketing.languageRomanUrdu}
              </button>
            );
          })}
        </div>
      ) : null}

      {captionPreview ? (
        <p className="mt-2.5 text-sm leading-relaxed text-muted">
          {captionPreview}
          {fullCaption && fullCaption.length > 160 ? "…" : ""}
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