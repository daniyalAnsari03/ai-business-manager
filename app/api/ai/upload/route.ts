import "server-only";

import { NextResponse } from "next/server";

import { getUserBusiness } from "@/lib/business/service";
import { getServerUser, getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

function extensionForType(type: string): string {
  switch (type) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    default:
      return "img";
  }
}

/**
 * POST /api/ai/upload — upload a product image for use in AI chat.
 * Authenticates the caller, resolves the business, uploads to the existing
 * product-images bucket, and returns the public URL.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const business = await getUserBusiness();
  if (!business?.setupCompleted) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
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
  const path = `${business.id}/${crypto.randomUUID()}.${extensionForType(file.type)}`;

  const bytes = await file.arrayBuffer();
  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, bytes, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });

  if (error) {
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);

  return NextResponse.json({ url: data.publicUrl });
}
