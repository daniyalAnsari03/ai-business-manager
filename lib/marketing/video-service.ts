import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import { generateVideoContent } from "@/lib/marketing/video-content";
import { decideAndRunAction } from "@/lib/marketing/approval-service";
import { configureApprovalExecutors } from "@/lib/marketing/approval-executors";

/**
 * Marketing video service — the ONLY place that talks to Supabase about
 * `marketing_videos` + the `marketing-videos` storage bucket. Ownership is
 * always derived from the authenticated server-side session; RLS is the second
 * enforcement layer.
 *
 * Uploads are stored in Supabase Storage under `marketing-videos/{businessId}/...`.
 * AI content (caption/hashtags/timing) is generated through the shared AI
 * architecture (lib/marketing/video-content.ts) — never fake visual analysis.
 * Publishing runs through the approval engine (decideAndRunAction).
 */

export type VideoServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "not_found"
  | "ai_unavailable"
  | "database_error";

export type VideoServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: VideoServiceError };

async function requireBusinessContext(): Promise<
  | { ok: true; supabase: SupabaseClient; business: Business }
  | { ok: false; reason: VideoServiceError }
> {
  let user;
  let supabase: SupabaseClient;
  try {
    user = await getServerUser();
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }
  if (!user) return { ok: false, reason: "unauthenticated" };

  const business = await getUserBusiness();
  if (!business) return { ok: false, reason: "no_business" };
  return { ok: true, supabase, business };
}

export interface MarketingVideo {
  id: string;
  businessId: string;
  storagePath: string;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  durationSeconds: number | null;
  captionEn: string | null;
  captionUr: string | null;
  caption: string | null;
  hashtags: string | null;
  suggestedPostTime: string | null;
  status: string;
  reviewDecision: string | null;
  approvalActionId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface VideoRow {
  id: string;
  business_id: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  duration_seconds: string | number | null;
  caption_en: string | null;
  caption_ur: string | null;
  caption: string | null;
  hashtags: string | null;
  suggested_post_time: string | null;
  status: string;
  review_decision: string | null;
  approval_action_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapVideo(row: VideoRow): MarketingVideo {
  return {
    id: row.id,
    businessId: row.business_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    durationSeconds:
      row.duration_seconds === null ? null : Number(row.duration_seconds),
    captionEn: row.caption_en,
    captionUr: row.caption_ur,
    caption: row.caption,
    hashtags: row.hashtags,
    suggestedPostTime: row.suggested_post_time,
    status: row.status,
    reviewDecision: row.review_decision,
    approvalActionId: row.approval_action_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** List the business's marketing videos, newest first. */
export async function listVideos(): Promise<VideoServiceResult<MarketingVideo[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("marketing_videos")
    .select("*")
    .eq("business_id", context.business.id)
    .order("created_at", { ascending: false });

  if (error) return { ok: false, reason: "database_error" };
  return {
    ok: true,
    data: ((data ?? []) as VideoRow[]).map(mapVideo),
  };
}

/** Creates a temporary signed URL for playback of one video (owner-only). */
export async function getVideoPlaybackUrl(
  storagePath: string,
): Promise<VideoServiceResult<string>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase.storage
    .from("marketing-videos")
    .createSignedUrl(storagePath, 3600);

  if (error) return { ok: false, reason: "database_error" };
  return { ok: true, data: data.signedUrl };
}

/**
 * Records an already-uploaded video (stored at `{businessId}/{fileName}`) and
 * generates AI caption/hashtags/timing. Status moves uploaded -> ai_generated.
 */
export async function createVideoFromUpload(input: {
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  durationSeconds?: number | null;
}): Promise<VideoServiceResult<MarketingVideo>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("marketing_videos")
    .insert({
      business_id: context.business.id,
      storage_path: input.storagePath,
      file_name: input.fileName,
      mime_type: input.mimeType,
      file_size_bytes: input.fileSizeBytes,
      duration_seconds: input.durationSeconds ?? null,
      status: "uploaded",
    })
    .select("*")
    .single();

  if (error) return { ok: false, reason: "database_error" };

  const video = mapVideo(data as VideoRow);

  // Generate AI content through the shared architecture.
  const content = await generateVideoContent({
    businessName: context.business.name,
    businessType: context.business.businessType,
    productName: null,
    language: context.business.language,
  });

  if (content.ok) {
    const selected = context.business.language === "ur" ? content.data.captionUr : content.data.captionEn;
    const { data: updated, error: updateError } = await context.supabase
      .from("marketing_videos")
      .update({
        status: "ai_generated",
        caption_en: content.data.captionEn,
        caption_ur: content.data.captionUr,
        caption: selected,
        hashtags: content.data.hashtags,
        suggested_post_time: content.data.suggestedPostTime,
      })
      .eq("id", video.id)
      .eq("business_id", context.business.id)
      .select("*")
      .single();

    if (!updateError && updated) {
      const mapped = mapVideo(updated as VideoRow);
      return { ok: true, data: { ...mapped, suggestedPostTime: content.data.suggestedPostTime } };
    }
  }

  // AI unavailable: keep the uploaded row (status stays uploaded) so the UI
  // can offer a retry; never fabricate content.
  if (video.suggestedPostTime === null && content.ok) {
    video.suggestedPostTime = content.data.suggestedPostTime;
  }
  return { ok: true, data: video };
}

/**
 * Re-runs AI content generation (caption/hashtags/timing) for an existing
 * video that is still in the `uploaded` state (e.g. the first AI call failed).
 * Owner-only; status moves to `ai_generated` on success.
 */
export async function regenerateVideoContent(
  videoId: string,
): Promise<VideoServiceResult<MarketingVideo>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data: row, error } = await context.supabase
    .from("marketing_videos")
    .select("*")
    .eq("id", videoId)
    .eq("business_id", context.business.id)
    .single();

  if (error || !row) return { ok: false, reason: "not_found" };

  const content = await generateVideoContent({
    businessName: context.business.name,
    businessType: context.business.businessType,
    productName: null,
    language: context.business.language,
  });
  if (!content.ok) return { ok: false, reason: "ai_unavailable" };

  const selected =
    context.business.language === "ur"
      ? content.data.captionUr
      : content.data.captionEn;
  const { data: updated, error: updateError } = await context.supabase
    .from("marketing_videos")
    .update({
      status: "ai_generated",
      caption_en: content.data.captionEn,
      caption_ur: content.data.captionUr,
      caption: selected,
      hashtags: content.data.hashtags,
      suggested_post_time: content.data.suggestedPostTime,
    })
    .eq("id", videoId)
    .eq("business_id", context.business.id)
    .select("*")
    .single();

  if (updateError || !updated) return { ok: false, reason: "database_error" };
  return { ok: true, data: mapVideo(updated as VideoRow) };
}

/**
 * Requests publishing of a video through the approval/automation engine.
 * In full-auto mode the (safe) publish action runs immediately; otherwise a
 * pending approval is created and (when WhatsApp is connected) an approval
 * request is sent.
 */
export async function requestVideoPublish(
  videoId: string,
): Promise<
  VideoServiceResult<
    | { outcome: "needs_approval" }
    | { outcome: "executed" }
    | { outcome: "not_ready" }
  >
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data: row, error: rowError } = await context.supabase
    .from("marketing_videos")
    .select("*")
    .eq("id", videoId)
    .eq("business_id", context.business.id)
    .single();

  if (rowError || !row) return { ok: false, reason: "not_found" };
  const video = mapVideo(row as VideoRow);

  // Only videos with AI content can be published (nothing else is reviewable).
  if (video.status !== "ai_generated") {
    return { ok: true, data: { outcome: "not_ready" } };
  }

  configureApprovalExecutors();

  const result = await decideAndRunAction({
    actionType: "publish_video",
    payload: {
      videoId: video.id,
      platform: "instagram",
      caption: video.caption,
      hashtags: video.hashtags,
      scheduledAt: video.suggestedPostTime,
    },
    summary: `Publish a video with caption: ${video.caption ?? "Untitled"}`,
    idempotencyKey: `video-publish-${video.id}`,
    executor: () => Promise.resolve({ ok: true, result: { videoId: video.id } }),
  });

  if (!result.ok) {
    const reason: VideoServiceError =
      result.reason === "not_found"
        ? "not_found"
        : result.reason === "invalid_input"
          ? "invalid_input"
          : result.reason === "not_configured"
            ? "not_configured"
            : "database_error";
    return { ok: false, reason };
  }

  // Link the approval action to the video.
  await context.supabase
    .from("marketing_videos")
    .update({ approval_action_id: result.data.action.id })
    .eq("id", video.id);

  if (result.data.outcome === "needs_approval") {
    return { ok: true, data: { outcome: "needs_approval" } };
  }
  return { ok: true, data: { outcome: "executed" } };
}
