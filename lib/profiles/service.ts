import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { isLanguage, type Language } from "@/lib/business/types";
import {
  getServerUser,
  getSupabaseServerClient,
  type SessionUser,
} from "@/lib/supabase/server";
import type { UserProfile } from "@/lib/profiles/types";

interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  preferred_language: string;
  created_at: string;
  updated_at: string;
}

function mapProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    preferredLanguage: isLanguage(row.preferred_language)
      ? row.preferred_language
      : "en",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Display name / avatar mirrored from Supabase Auth metadata. */
function metadataDisplayName(user: SessionUser): string | null {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const candidates = ["full_name", "name"];
  for (const key of candidates) {
    const value = meta[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function metadataAvatarUrl(user: SessionUser): string | null {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  for (const key of ["avatar_url", "picture"]) {
    const value = meta[key];
    if (
      typeof value === "string" &&
      value.startsWith("https://") &&
      value.length <= 2048
    ) {
      return value;
    }
  }
  return null;
}

/**
 * The signed-in user's application profile. Rows are provisioned by a
 * database trigger at signup; this lazily backfills older accounts using
 * identity data from the validated server session only.
 */
async function ensureProfileFor(
  user: SessionUser,
  supabase: SupabaseClient,
): Promise<UserProfile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (data) {
    const row = data as ProfileRow;

    // Self-heal: rows provisioned before Google identity metadata existed
    // can have a NULL avatar even though the validated session provides
    // one. Backfill it from session metadata only — nothing else changes.
    if (!row.avatar_url) {
      const avatarUrl = metadataAvatarUrl(user);
      if (avatarUrl) {
        const { data: updated } = await supabase
          .from("profiles")
          .update({ avatar_url: avatarUrl })
          .eq("id", user.id)
          .select("*")
          .maybeSingle();
        if (updated) return mapProfile(updated as ProfileRow);
      }
    }

    return mapProfile(row);
  }

  const { data: created, error } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      email: user.email,
      display_name: metadataDisplayName(user),
      avatar_url: metadataAvatarUrl(user),
    })
    .select("*")
    .single();

  if (error || !created) return null;
  return mapProfile(created as ProfileRow);
}

/** Profile for the current session user, or null when unauthenticated. */
export const getUserProfile = cache(async (): Promise<UserProfile | null> => {
  const user = await getServerUser();
  if (!user) return null;

  try {
    const supabase = await getSupabaseServerClient();
    return await ensureProfileFor(user, supabase);
  } catch {
    // Supabase not configured — callers fall back to safe defaults.
    return null;
  }
});

export interface ProfileMutationResult {
  ok: boolean;
  reason?: "unauthenticated" | "invalid_input" | "not_configured" | "database_error";
}

/**
 * Persists the language preference to the profile row. Ownership comes from
 * the authenticated session; RLS is the second enforcement layer.
 */
export async function updatePreferredLanguage(
  input: unknown,
): Promise<ProfileMutationResult> {
  let user: SessionUser | null;
  let supabase: SupabaseClient;
  try {
    user = await getServerUser();
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }

  if (!user) return { ok: false, reason: "unauthenticated" };
  if (typeof input !== "string" || !isLanguage(input)) {
    return { ok: false, reason: "invalid_input" };
  }
  const language: Language = input;

  const { error } = await supabase
    .from("profiles")
    .update({ preferred_language: language })
    .eq("id", user.id);

  if (error) return { ok: false, reason: "database_error" };
  return { ok: true };
}

/**
 * Best-effort mirror of the chosen language onto the profile during Business
 * Setup. A missing/failed sync never blocks setup itself.
 */
export async function syncProfileLanguage(
  userId: string,
  language: Language,
): Promise<void> {
  try {
    const supabase = await getSupabaseServerClient();
    await supabase
      .from("profiles")
      .upsert(
        { id: userId, preferred_language: language },
        { onConflict: "id", ignoreDuplicates: false },
      );
  } catch {
    // Non-critical mirror — business record remains authoritative.
  }
}
