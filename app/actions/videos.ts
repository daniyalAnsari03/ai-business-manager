"use server";

import {
  listVideos,
  requestVideoPublish,
  getVideoPlaybackUrl,
  regenerateVideoContent,
  type VideoServiceError,
  type MarketingVideo,
} from "@/lib/marketing/video-service";

export type VideosActionState =
  | { ok: true; videos: MarketingVideo[] }
  | { ok: false; reason: VideoServiceError };

/** The business's uploaded marketing videos with AI content. */
export async function listVideosAction(): Promise<VideosActionState> {
  const result = await listVideos();
  return result.ok
    ? { ok: true, videos: result.data }
    : { ok: false, reason: result.reason };
}

export type VideoPlaybackUrlActionState =
  | { ok: true; url: string }
  | { ok: false; reason: VideoServiceError };

/** Short-lived signed playback URL for one of the business's videos. */
export async function getVideoPlaybackUrlAction(
  storagePath: string,
): Promise<VideoPlaybackUrlActionState> {
  const result = await getVideoPlaybackUrl(storagePath);
  return result.ok
    ? { ok: true, url: result.data }
    : { ok: false, reason: result.reason };
}

export type VideoRetryActionState =
  | { ok: true; video: MarketingVideo }
  | { ok: false; reason: VideoServiceError };

/** Re-runs AI content generation for a video that is not yet ai_generated. */
export async function regenerateVideoContentAction(
  videoId: string,
): Promise<VideoRetryActionState> {
  const result = await regenerateVideoContent(videoId);
  return result.ok
    ? { ok: true, video: result.data }
    : { ok: false, reason: result.reason };
}

export type VideoPublishActionState =
  | { ok: true; outcome: "needs_approval" | "executed" | "not_ready" }
  | { ok: false; reason: VideoServiceError };

/** Requests publishing of a video through the approval/automation engine. */
export async function requestVideoPublishAction(
  videoId: string,
): Promise<VideoPublishActionState> {
  const result = await requestVideoPublish(videoId);
  return result.ok
    ? { ok: true, outcome: result.data.outcome }
    : { ok: false, reason: result.reason };
}
