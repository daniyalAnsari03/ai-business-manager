import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

/**
 * Server-side Supabase client bound to the request's cookies so RLS runs as
 * the authenticated user. Server components/actions/route handlers only.
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = getSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a server component render pass — session refresh is
          // handled by middleware instead.
        }
      },
    },
  });
}

/**
 * A server-side Supabase client authenticated with the service-role key
 * (bypasses RLS). Used ONLY for deliberate, isolated admin operations that
 * must span every business — e.g. the global marketing-draft backfill
 * (docs/phase0.txt). Returns null when no service-role key is configured so
 * callers can degrade gracefully instead of crashing.
 *
 * SECURITY: the service-role key must never leave the server. It is read
 * here from the server-side environment only, never exposed to the client.
 */
export async function getSupabaseAdminClient(): Promise<SupabaseClient | null> {
  const { url } = getSupabasePublicConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/** The validated identity fields application code relies on. */
export interface SessionUser {
  id: string;
  email: string | null;
  user_metadata: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Authenticated user derived from the server session (never client input).
 *
 * `getClaims()` cryptographically verifies the session's access token
 * against the project's published signing keys locally (asymmetric JWT
 * projects), so a valid session costs no network round trip to the Auth
 * server. Expired sessions are still refreshed automatically through the
 * cookie handlers, and legacy symmetric-key projects fall back to remote
 * validation inside getClaims() itself — validation strength is identical
 * to getUser(), minus the per-request latency that used to sit in front of
 * every dashboard navigation and data fetch.
 *
 * `cache()` memoizes per request: layouts, pages and services all resolve
 * the session through this function and share one verification per request.
 */
export const getServerUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await getSupabaseServerClient();

  let subject: string | null = null;
  let email: string | null = null;
  let userMetadata: Record<string, unknown> = {};
  try {
    const { data } = await supabase.auth.getClaims();
    if (data?.claims && typeof data.claims.sub === "string") {
      subject = data.claims.sub;
      const rawClaims = data.claims as Record<string, unknown>;
      if (typeof rawClaims.email === "string") email = rawClaims.email;
      if (isRecord(rawClaims.user_metadata)) userMetadata = rawClaims.user_metadata;
    }
  } catch {
    return null;
  }

  if (!subject) return null;

  return {
    id: subject,
    email,
    user_metadata: userMetadata,
  };
});
