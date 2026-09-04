import type { Metadata } from "next";
import { VideoView } from "@/components/marketing/video-view";
import { listVideos } from "@/lib/marketing/video-service";

export const metadata: Metadata = {
  title: "Marketing Video",
};

export const dynamic = "force-dynamic";

/**
 * Marketing Video page — real upload + AI content generation + approval-based
 * publishing. No visual content is ever analysed or described; the AI prepares
 * a caption/hashtags/timing recommendation and publishing goes through the
 * approval/automation engine.
 */
export default async function VideoPage() {
  const result = await listVideos();

  return (
    <VideoView
      initialVideos={result.ok ? result.data : []}
      loadFailed={!result.ok}
    />
  );
}