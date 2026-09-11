"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import {
  getVideoPlaybackUrlAction,
  listVideosAction,
  regenerateVideoContentAction,
  requestVideoPublishAction,
} from "@/app/actions/videos";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  ImageIcon,
  LoaderIcon,
  PlusIcon,
} from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import type { MarketingVideo } from "@/lib/marketing/video-service";
import { cn } from "@/lib/utils";

type VideoViewProps = {
  initialVideos: MarketingVideo[];
  loadFailed?: boolean;
};

type Feedback =
  | { kind: "info"; text: string }
  | { kind: "error"; text: string }
  | null;

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

/**
 * Marketing Video (Phase 4) — real upload to owner-scoped Storage, AI content
 * generation, and approval-driven publishing. No fabricated previews.
 */
export function VideoView({
  initialVideos,
  loadFailed = false,
}: VideoViewProps) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [videos, setVideos] = useState<MarketingVideo[]>(initialVideos);
  const [uploading, setUploading] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [playbackSrcs, setPlaybackSrcs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<MarketingVideo | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await listVideosAction();
    if (result.ok) setVideos(result.videos);
  }, []);

  async function handleFile(file: File | undefined | null) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setFeedback({ kind: "error", text: t.marketing.videoTooLarge });
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setFeedback({ kind: "error", text: t.marketing.videoBadType });
      return;
    }

    setUploadFailed(false);
    setFeedback(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/marketing/videos/upload", {
        method: "POST",
        body,
      });
      if (!response.ok) {
        setUploadFailed(true);
        setFeedback({ kind: "error", text: t.marketing.videoUploadFailed });
        return;
      }
      const json = (await response.json()) as { video?: MarketingVideo };
      if (!json.video) {
        setUploadFailed(true);
        setFeedback({ kind: "error", text: t.marketing.videoUploadFailed });
        return;
      }
      setFeedback({ kind: "info", text: t.marketing.videoUploadSuccess });
      await refresh();
    } catch {
      setUploadFailed(true);
      setFeedback({ kind: "error", text: t.marketing.videoUploadFailed });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handlePlay(video: MarketingVideo) {
    setPreview(video);
    if (!playbackSrcs[video.id]) {
      const result = await getVideoPlaybackUrlAction(video.storagePath);
      if (result.ok) {
        setPlaybackSrcs((prev) => ({ ...prev, [video.id]: result.url }));
      }
    }
  }

  async function handlePublish(video: MarketingVideo) {
    setPublishingId(video.id);
    setFeedback(null);
    try {
      const result = await requestVideoPublishAction(video.id);
      if (!result.ok) {
        setFeedback({
          kind: "error",
          text: mapVideoError(result.reason, t),
        });
        return;
      }
      if (result.outcome === "needs_approval") {
        setFeedback({
          kind: "info",
          text: t.marketing.videoNeedsApproval,
        });
      } else if (result.outcome === "executed") {
        setFeedback({ kind: "info", text: t.marketing.videoPublished });
      } else {
        setFeedback({ kind: "error", text: t.marketing.videoNotReady });
      }
      await refresh();
    } catch {
      setFeedback({ kind: "error", text: t.marketing.videoUploadFailed });
    } finally {
      setPublishingId(null);
    }
  }

  async function handleRetry(video: MarketingVideo) {
    setRetryingId(video.id);
    setFeedback(null);
    try {
      const result = await regenerateVideoContentAction(video.id);
      setFeedback(
        result.ok
          ? { kind: "info", text: t.marketing.videoUploadSuccess }
          : { kind: "error", text: t.marketing.videoUploadFailed },
      );
      await refresh();
    } catch {
      setFeedback({ kind: "error", text: t.marketing.videoUploadFailed });
    } finally {
      setRetryingId(null);
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

      {/* Upload */}
      <Card lift={false} className="relative overflow-hidden">
        <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
        <div className="relative">
          <h2 className="text-sm font-medium uppercase tracking-widest text-faint">
            {t.marketing.videoUploadTitle}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {t.marketing.videoUploadHint}
          </p>

          <label className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center transition-colors hover:border-emerald-500/40">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
            {uploading ? (
              <LoaderIcon className="size-7 animate-spin text-accent" />
            ) : (
              <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
                <PlusIcon className="size-5" />
              </span>
            )}
            <span className="text-sm font-medium">
              {uploading
                ? t.marketing.videoUploading
                : t.marketing.videoUploadButton}
            </span>
            {uploadFailed ? (
              <span className="flex items-center gap-1 text-xs text-muted">
                <AlertTriangleIcon className="size-3.5" />
                {t.marketing.videoUploadFailed}
              </span>
            ) : null}
          </label>
        </div>
      </Card>

      {/* Video library */}
      <section aria-labelledby="video-library-title">
        <Card lift={false} className="relative overflow-hidden">
          <div className="relative">
            <h2
              id="video-library-title"
              className="text-sm font-medium uppercase tracking-widest text-faint"
            >
              {t.marketing.videoTitle}
            </h2>

            {videos.length > 0 ? (
              <ul className="mt-5 grid gap-4 sm:grid-cols-2">
                {videos.map((video) => (
                  <VideoCard
                    key={video.id}
                    video={video}
                    publishing={publishingId === video.id}
                    retrying={retryingId === video.id}
                    onPlay={() => handlePlay(video)}
                    onPublish={() => handlePublish(video)}
                    onRetry={() => handleRetry(video)}
                  />
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center py-12 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
                  <ImageIcon className="size-6" />
                </span>
                <h3 className="mt-5 font-display text-2xl font-light">
                  {t.marketing.videoEmptyTitle}
                </h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
                  {t.marketing.videoEmptyBody}
                </p>
              </div>
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
            <ImageIcon className="size-3.5" />
            {t.marketing.videoNav}
          </>
        }
        title={t.marketing.videoTitle}
        subtitle={t.marketing.videoSubtitle}
      />

      {loadFailed ? (
        <Card lift={false} className="flex flex-col items-center py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
            <AlertTriangleIcon className="size-6" />
          </span>
          <h2 className="mt-5 font-display text-2xl font-light">
            {t.marketing.videoLoadError}
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
        <div className="space-y-6">{content}</div>
      ) : (
        <motion.div
          className="space-y-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {content}
        </motion.div>
      )}

      <AnimatePresence>
        {preview ? (
          <Modal
            open
            onClose={() => setPreview(null)}
            title={preview.fileName ?? t.marketing.videoPlaybackLabel}
            size="lg"
          >
            <div className="overflow-hidden rounded-2xl border border-line bg-black">
              {playbackSrcs[preview.id] ? (
                <video
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  className="aspect-video w-full"
                  src={playbackSrcs[preview.id]}
                >
                  {preview.fileName ?? "video"}
                </video>
              ) : (
                <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 text-muted">
                  <LoaderIcon className="size-6 animate-spin" />
                  <span className="text-sm">{t.common.loading}</span>
                </div>
              )}
            </div>
            <p className="mt-3 text-xs text-faint">
              {preview.caption ?? t.marketing.videoNotReady}
            </p>
          </Modal>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function VideoCard({
  video,
  publishing,
  retrying,
  onPlay,
  onPublish,
  onRetry,
}: {
  video: MarketingVideo;
  publishing: boolean;
  retrying: boolean;
  onPlay: () => void;
  onPublish: () => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const aiReady = video.status === "ai_generated";

  return (
    <li className="overflow-hidden rounded-2xl border border-line bg-surface">
      <button
        type="button"
        onClick={onPlay}
        className="flex aspect-video w-full items-center justify-center bg-black/40 text-faint transition-colors hover:text-accent"
        aria-label={t.marketing.videoPlaybackLabel}
      >
        <ImageIcon className="size-8" />
      </button>

      <div className="space-y-3 p-4">
        <p className="truncate text-sm font-medium">{video.fileName ?? "Video"}</p>

        {aiReady ? (
          <div className="space-y-2 text-sm leading-relaxed text-muted">
            {video.caption ? <p className="line-clamp-2">“{video.caption}”</p> : null}
            {video.hashtags ? (
              <p className="truncate text-xs text-faint">{video.hashtags}</p>
            ) : null}
            {video.suggestedPostTime ? (
              <p className="flex items-center gap-1.5 text-xs text-faint">
                <ClockIcon className="size-3.5" />
                {t.marketing.videoBestTime}: {formatTime(video.suggestedPostTime)}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-faint">
              {t.marketing.videoBestTimeHint}
            </span>
            <Button
              size="md"
              variant="ghost"
              disabled={retrying}
              onClick={onRetry}
            >
              {retrying ? t.common.loading : t.marketing.videoRetry}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {video.approvalActionId ? (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              {t.marketing.videoNeedsApproval}
            </span>
          ) : aiReady ? (
            <Button
              size="md"
              variant="primary"
              disabled={publishing}
              onClick={onPublish}
            >
              {publishing ? t.common.loading : t.marketing.videoPublishButton}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

type VideoErrorReason =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "not_found"
  | "ai_unavailable"
  | "database_error";

function mapVideoError(
  reason: VideoErrorReason,
  t: { marketing: { videoNotReady: string; videoUploadFailed: string } },
): string {
  switch (reason) {
    case "invalid_input":
      return t.marketing.videoNotReady;
    case "not_found":
      return t.marketing.videoUploadFailed;
    default:
      return t.marketing.videoUploadFailed;
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}