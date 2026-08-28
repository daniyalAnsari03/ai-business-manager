import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/** Only same-app relative paths are accepted as redirect targets. */
function sanitizeNext(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/dashboard";
}

/**
 * Auth callback for email confirmations, magic links and OAuth:
 * 1. PKCE flow — Supabase redirects here with `?code=...`; the code is
 *    exchanged for a session cookie.
 * 2. Token-hash links — custom email templates built on `{{ .TokenHash }}`
 *    arrive with `?token_hash=...&type=signup`; verified via verifyOtp.
 * 3. Failed verifications (expired/used link) arrive with `?error=...` and
 *    are routed back to login with a safe, localized message.
 *
 * The dashboard layout decides whether the user still needs Business Setup.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = searchParams.get("type") as EmailOtpType | null;
  const next = sanitizeNext(searchParams.get("next"));

  if (code || (tokenHash && otpType)) {
    try {
      const supabase = await getSupabaseServerClient();

      const { error } =
        code !== null
          ? await supabase.auth.exchangeCodeForSession(code)
          : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: otpType! });

      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }
    } catch {
      // Supabase not configured — fall through to the error redirect.
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
