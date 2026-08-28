import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const LOGIN_PATH = "/login";
const PROTECTED_PREFIXES = ["/dashboard", "/setup"] as const;

/** Only allow same-app relative redirect targets. */
function sanitizeNext(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/dashboard";
}

/**
 * Session refresh + first layer of route protection. Onboarding-state gating
 * (setup completed or not) is enforced again inside the server layouts so
 * protected access never relies on client-side checks alone.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const { pathname } = request.nextUrl;

  // Supabase not configured yet — keep Phase 1 routes working untouched.
  if (!url || !publishableKey) return NextResponse.next();

  // Fast path: without any Supabase auth cookie there is no session to
  // validate or refresh, so the user is anonymous by definition. Skip the
  // client creation and the getUser() round trip entirely — public pages
  // and API routes respond without waiting on the Auth server. Requests
  // that DO carry session cookies always take the full validation path.
  const hasAuthCookies = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-"));
  if (!hasAuthCookies) {
    // Protected route without any session → straight to login.
    if (
      PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    ) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = LOGIN_PATH;
      loginUrl.search = "";
      loginUrl.searchParams.set("next", sanitizeNext(pathname));
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims() cryptographically verifies the session's access token
  // against the project's published signing keys (asymmetric JWT projects)
  // without a round trip to the Auth server; expired sessions are still
  // refreshed through the cookie handlers, and legacy symmetric-key
  // projects automatically fall back to server-side validation inside
  // getClaims(). Same validation strength as getUser(), minus the
  // per-request network cost that used to sit in front of every page
  // navigation and every <Link> prefetch.
  const { data } = await supabase.auth.getClaims();
  const hasValidSession = Boolean(data?.claims);

  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );

  if (!hasValidSession && isProtected) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    loginUrl.search = "";
    loginUrl.searchParams.set("next", sanitizeNext(pathname));
    return NextResponse.redirect(loginUrl);
  }

  if (hasValidSession && pathname === LOGIN_PATH) {
    const appUrl = request.nextUrl.clone();
    appUrl.pathname = sanitizeNext(request.nextUrl.searchParams.get("next"));
    appUrl.search = "";
    return NextResponse.redirect(appUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on all pages except static assets and Next internals.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
