# Supabase Auth — Email Confirmation for Local Development

The confirmation email link always goes to your Supabase project first
(`/auth/v1/verify?...&redirect_to=...`). Where Supabase sends the browser
after verifying depends entirely on the URL configuration below. If these
are wrong, clicking "Confirm Email" opens localhost but never reaches
`/auth/callback`, so no session is established.

## Required dashboard settings (one-time)

Supabase Dashboard → your project → **Authentication → URL Configuration**:

1. **Site URL**
   - Local development: `http://localhost:3000`
   - Production: your deployed URL (change this when you deploy)

2. **Redirect URLs** (allow-list) — must contain BOTH:

   ```
   http://localhost:3000/**
   https://your-production-domain.com/**
   ```

   If a redirect target is not on this list, Supabase silently ignores it
   and falls back to the Site URL. This is the most common reason the
   confirmation flow "opens localhost but does not complete".

## How the flow works in this app

```
Sign up (login form)
  → signUp({ emailRedirectTo: "<origin>/auth/callback?next=/dashboard" })
  → confirmation email
  → click "Confirm Email"
  → Supabase verifies token
  → redirects to http://localhost:3000/auth/callback?code=...
  → app/auth/callback/route.ts exchanges code for session cookie (PKCE)
  → /dashboard (layout redirects to /setup until setup is completed)
  → dashboard after setup
```

Notes:

- Email confirmation stays enabled; nothing is bypassed.
- Google OAuth uses the same callback route.
- Expired/already-used links land on `/auth/callback` without a valid
  `code`/`token_hash` and are sent to `/login?error=auth` with a safe,
  localized message.
- If you customize the email template to use `{{ .TokenHash }}` instead of
  `{{ .ConfirmationURL }}`, the callback also handles
  `?token_hash=...&type=signup`.
