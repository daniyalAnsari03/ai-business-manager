import "server-only";

import { NextResponse } from "next/server";

import { getUserBusiness } from "@/lib/business/service";
import { getServerUser, getSupabaseServerClient } from "@/lib/supabase/server";
import { createVideoFromUpload } from "@/lib/marketing/video-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

/**
 * POST /api/marketing/videos/upload
 *
 * Uploads a video to the owner-scoped `marketing-videos` Storage bucket and
 * records it in `marketing_videos`, generating AI caption/hashtags/timing via
 * the shared AI architecture. Ownership is resolved server-side from the
 * authenticated session — no client business id is trusted.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const business = await getUserBusiness();
  if (!business) {
    return NextResponse.json({ error: "no_business" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "bad_type" }, { status: 400 });
  }

  const supabase = await getSupabaseServerClient();
  const ext =
    file.type === "video/mp4"
      ? "mp4"
      : file.type === "video/webm"
        ? "webm"
        : "mov";
  const path = `${business.id}/${crypto.randomUUID()}.${ext}`;

  const bytes = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from("marketing-videos")
    .upload(path, bytes, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }

  const result = await createVideoFromUpload({
    storagePath: path,
    fileName: file.name,
    mimeType: file.type,
    fileSizeBytes: file.size,
  });

  if (!result.ok) {
    return NextResponse.json({ error: "database_error" }, { status: 500 });
  }

  return NextResponse.json({ video: result.data });
}
