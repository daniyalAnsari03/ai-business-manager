import type { Metadata } from "next";
import { PublishedPostsView } from "@/components/marketing/published-posts-view";
import { listPublishedPosts } from "@/lib/marketing/social-posts";

export const metadata: Metadata = {
  title: "Published Posts",
};

export const dynamic = "force-dynamic";

export default async function PublishedPostsPage() {
  const postsResult = await listPublishedPosts();

  return (
    <PublishedPostsView
      initialPosts={postsResult.ok ? postsResult.data : []}
      postsLoadFailed={!postsResult.ok}
    />
  );
}