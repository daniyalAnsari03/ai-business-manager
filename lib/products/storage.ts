"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Product image upload — direct browser -> Supabase Storage so image bytes
 * never proxy through the Next.js server. The bucket's storage policies
 * verify that the first path segment is a business OWNED BY the signed-in
 * user (resolved server-side from the session), so the client-chosen path
 * can never escape the caller's own business folder.
 */

export const PRODUCT_IMAGE_BUCKET = "product-images";
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB, matches bucket limit

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export type ImageUploadResult =
  | { ok: true; url: string }
  | { ok: false; reason: "too_large" | "bad_type" | "upload_failed" };

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

export function validateImageFile(file: File): "too_large" | "bad_type" | null {
  if (!ALLOWED_TYPES.has(file.type)) return "bad_type";
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) return "too_large";
  return null;
}

export async function uploadProductImage(
  file: File,
  businessId: string,
): Promise<ImageUploadResult> {
  const invalid = validateImageFile(file);
  if (invalid) return { ok: false, reason: invalid };

  try {
    const supabase = getSupabaseBrowserClient();
    const path = `${businessId}/${crypto.randomUUID()}.${extensionForType(file.type)}`;

    const { error } = await supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(path, file, {
        contentType: file.type,
        cacheControl: "31536000",
        upsert: false,
      });

    if (error) return { ok: false, reason: "upload_failed" };

    const { data } = supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .getPublicUrl(path);

    return { ok: true, url: data.publicUrl };
  } catch {
    return { ok: false, reason: "upload_failed" };
  }
}

/** Best-effort removal of a product image object from its public URL. */
export async function removeProductImage(publicUrl: string): Promise<void> {
  try {
    const marker = `/${PRODUCT_IMAGE_BUCKET}/`;
    const index = publicUrl.indexOf(marker);
    if (index === -1) return;

    const objectPath = decodeURIComponent(
      publicUrl.slice(index + marker.length),
    );
    await getSupabaseBrowserClient()
      .storage.from(PRODUCT_IMAGE_BUCKET)
      .remove([objectPath]);
  } catch {
    // Non-critical cleanup — never block the product save on this.
  }
}
