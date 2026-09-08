"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  deletePublishedPostAction,
  listPublishedPostsAction,
} from "@/app/actions/marketing";
import { Spinner } from "@/components/customers/customer-form-modal";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ImageIcon,
  MegaPhoneIcon,
  RefreshCwIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import type { ActivityPost } from "@/lib/marketing/social-posts";
import { EASE_PREMIUM, staggerContainer } from "@/components/motion/presets";

export function PublishedPostsView({
  initialPosts,
  postsLoadFailed = false,
}: {
  initialPosts: ActivityPost[];
  postsLoadFailed?: boolean;
}) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const [posts, setPosts] = useState<ActivityPost[]>(initialPosts);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<{
    kind: "error" | "info" | "success";
    text: string;
  } | null>(null);

  const postsLoadError = postsLoadFailed;

  useEffect(() => {
    if (!deleteMessage) return;
    const timer = window.setTimeout(() => setDeleteMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [deleteMessage]);

  async function handleDelete(post: ActivityPost) {
    if (!confirm(t.marketing.publishedConfirmDelete)) return;
    setDeletingId(post.id);
    setDeleteMessage(null);
    try {
      const result = await deletePublishedPostAction(post.id);
      if (result.ok) {
        setPosts((prev) => prev.filter((p) => p.id !== post.id));
        setDeleteMessage({
          kind: "success",
          text: t.marketing.publishedDeleteSuccess,
        });
      } else {
        setDeleteMessage({ kind: "error", text: t.marketing.publishedDeleteFailed });
      }
    } catch {
      setDeleteMessage({ kind: "error", text: t.marketing.publishedDeleteFailed });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshFailed(false);
    try {
      const result = await listPublishedPostsAction();
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

  if (postsLoadError) {
    return (
      <div className="space-y-6">
        <PublishedHeader />
        <Card lift={false} className="flex flex-col items-center py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
            <MegaPhoneIcon className="size-6" />
          </span>
          <h2 className="mt-5 font-display text-2xl font-light">
            {t.marketing.publishedLoadError}
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

  const content = (
    <>
      <PublishedHeader />

      <section aria-labelledby="marketing-published-title">
        <Card lift={false} className="relative overflow-hidden">
          <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="marketing-published-title"
                className="text-sm font-medium uppercase tracking-widest text-faint"
              >
                {t.marketing.publishedTitle}
              </h2>
              <Button
                size="md"
                variant="ghost"
                className="min-h-9 px-3 text-xs"
                disabled={refreshing}
                onClick={handleRefresh}
                aria-label={t.marketing.publishedRefresh}
              >
                <RefreshCwIcon className="size-3.5" />
                {refreshing
                  ? t.marketing.publishedRefreshing
                  : t.marketing.publishedRefresh}
              </Button>
            </div>

            {refreshFailed ? (
              <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                {t.marketing.publishedLoadError}
              </div>
            ) : posts.length > 0 ? (
              <ul className="mt-5 space-y-3">
                {posts.map((post) => (
                  <li key={post.id}>
                    <PublishedPostCard
                      post={post}
                      deleting={deletingId === post.id}
                      onDelete={() => handleDelete(post)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center py-12 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
                  <ImageIcon className="size-6" />
                </span>
                <h3 className="mt-5 font-display text-2xl font-light">
                  {t.marketing.publishedEmptyTitle}
                </h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
                  {t.marketing.publishedEmptyBody}
                </p>
              </div>
            )}

            <AnimatePresence>
              {deleteMessage ? (
                <motion.p
                  role="status"
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reducedMotion ? undefined : { opacity: 0 }}
                  transition={{ duration: 0.25, ease: EASE_PREMIUM }}
                  className={cn(
                    "mt-4 flex items-start gap-1.5 text-sm leading-relaxed",
                    deleteMessage.kind === "error"
                      ? "text-muted"
                      : "font-medium text-emerald-700 dark:text-emerald-300",
                  )}
                >
                  {deleteMessage.kind === "error" ? (
                    <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <CheckCircleIcon className="mt-0.5 size-4 shrink-0" />
                  )}
                  {deleteMessage.text}
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

function PublishedHeader() {
  const { t } = useI18n();
  return (
    <PageHeader
      eyebrow={
        <>
          <MegaPhoneIcon className="size-3.5" />
          {t.nav.marketing}
        </>
      }
      title={t.marketing.publishedTitle}
      subtitle={t.marketing.publishedSubtitle}
    />
  );
}

function PublishedPostCard({
  post,
  deleting,
  onDelete,
}: {
  post: ActivityPost;
  deleting: boolean;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const displayCaption = post.selectedLanguage === "ur" ? post.captionUr : post.captionEn;

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {post.productName ?? t.marketing.activityTitle}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
              <CheckCircleIcon className="size-3.5" />
              {t.marketing.postPublishedStatus}
            </span>
            {post.publishedAt && (
              <span className="text-faint">
                {new Date(post.publishedAt).toLocaleDateString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            )}
            {post.platform && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-700 capitalize dark:text-emerald-300">
                {post.platform}
              </span>
            )}
          </div>
          {post.externalPostReference ? (
            <p className="mt-1 text-xs text-faint">
              Ref: {post.externalPostReference}
            </p>
          ) : null}
        </div>
        <Button
          size="md"
          variant="ghost"
          className="min-h-9 px-3 text-xs text-red-600 hover:bg-red-500/10"
          disabled={deleting}
          onClick={onDelete}
        >
          {deleting ? (
            <>
              <Spinner />
              {t.common.deleting}
            </>
          ) : (
            <>
              <TrashIcon className="size-3.5" />
              {t.common.delete}
            </>
          )}
        </Button>
      </div>

      {displayCaption ? (
        <p className="mt-2.5 text-sm leading-relaxed text-muted">
          {displayCaption.slice(0, 300)}
          {displayCaption.length > 300 ? "…" : ""}
        </p>
      ) : null}
    </div>
  );
}