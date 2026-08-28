"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeOffIcon,
  GoogleIcon,
  MailIcon,
} from "@/components/ui/icons";
import { TextField } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";
type PendingAction = "signin" | "signup" | "google" | null;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;

function sanitizeNext(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/dashboard";
}

/** Maps Supabase auth error codes to safe, localized messages. */
function mapAuthErrorCode(code: string | undefined) {
  switch (code) {
    case "invalid_credentials":
      return "invalidCredentials" as const;
    case "email_not_confirmed":
      return "confirmationNeeded" as const;
    case "user_already_exists":
    case "email_exists":
      return "emailInUse" as const;
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "rateLimited" as const;
    default:
      return null;
  }
}

export function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();

  const nextPath = sanitizeNext(searchParams.get("next"));
  const callbackError = searchParams.get("error") === "auth";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const [formError, setFormError] = useState<string | null>(
    callbackError ? t.login.errors.authCallback : null,
  );
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  // Keep the visible message in sync when the language changes.
  useEffect(() => {
    if (!formError) return;
    if (callbackError) setFormError(t.login.errors.authCallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  function validate(): boolean {
    const errors: { email?: string; password?: string } = {};
    if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email =
        mode === "signin"
          ? "Enter a valid email address."
          : "Sahi email address likhein.";
    }
    if (
      password.length <
      (mode === "signup" ? PASSWORD_MIN_LENGTH : 6)
    ) {
      errors.password =
        mode === "signup"
          ? `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
          : "Password kam az kam 6 huroof ka hona chahiye.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setAwaitingConfirmation(false);
    if (!validate()) return;

    setPending(mode === "signin" ? "signin" : "signup");
    try {
      const supabase = getSupabaseBrowserClient();

      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          const mapped = mapAuthErrorCode(error.code);
          setFormError(
            mapped ? t.login.errors[mapped] : t.common.errorGeneric,
          );
          setPending(null);
          return;
        }
        router.replace(nextPath);
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // The confirmation email must return to our callback route so the
          // auth code is exchanged for a session. Without this, Supabase
          // falls back to the dashboard Site URL and verification stalls.
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (error) {
        const mapped = mapAuthErrorCode(error.code);
        setFormError(mapped ? t.login.errors[mapped] : t.common.errorGeneric);
        setPending(null);
        return;
      }
      if (data.session) {
        router.replace(nextPath);
        return;
      }
      // No session: the project requires email confirmation.
      setAwaitingConfirmation(true);
    } catch {
      setFormError(t.login.errors.notConfigured);
    } finally {
      setPending(null);
    }
  }

  async function handleGoogle() {
    setFormError(null);
    setPending("google");
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (error) setFormError(t.common.errorGeneric);
    } catch {
      setFormError(t.login.errors.notConfigured);
    } finally {
      setPending(null);
    }
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setFormError(null);
    setFieldErrors({});
    setAwaitingConfirmation(false);
  }

  if (awaitingConfirmation) {
    return (
      <div className="text-center" role="status">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-accent">
          <MailIcon className="size-7" />
        </span>
        <h2 className="mt-5 font-display text-display-md font-light">
          {t.login.checkEmailTitle}
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted">
          {t.login.checkEmailBody.replace("{email}", email.trim())}
        </p>
        <Button
          variant="secondary"
          size="md"
          className="mt-7"
          onClick={() => switchMode("signin")}
        >
          {t.login.toggleToSignIn}
        </Button>
      </div>
    );
  }

  const isWorking = pending !== null;

  return (
    <div>
      <h1 className="text-center font-display text-display-md font-light text-balance">
        {t.login.title}
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-center text-[15px] leading-relaxed text-muted">
        {t.login.subtitle}
      </p>

      {formError ? (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          {formError}
        </div>
      ) : null}

      <div className="mt-7 space-y-4">
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={handleGoogle}
          disabled={isWorking}
        >
          {pending === "google" ? (
            <Spinner />
          ) : (
            <GoogleIcon className="size-5 shrink-0" />
          )}
          {t.login.continueWithGoogle}
        </Button>

        <div className="flex items-center gap-4" aria-hidden>
          <span className="hairline flex-1" />
          <span className="text-xs uppercase tracking-widest text-faint">
            {t.login.orEmail}
          </span>
          <span className="hairline flex-1" />
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <TextField
            id="login-email"
            label={t.login.emailLabel}
            type="email"
            name="email"
            autoComplete="email"
            placeholder={t.login.emailPlaceholder}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={fieldErrors.email}
            required
          />
          <TextField
            id="login-password"
            label={t.login.passwordLabel}
            type={showPassword ? "text" : "password"}
            name="password"
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
            hint={mode === "signup" ? t.login.passwordHintSignUp : undefined}
            required
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? t.login.hidePassword : t.login.showPassword}
                className="inline-flex size-9 items-center justify-center rounded-full text-faint transition-colors hover:text-accent min-touch-target"
              >
                {showPassword ? (
                  <EyeOffIcon className="size-[18px]" />
                ) : (
                  <EyeIcon className="size-[18px]" />
                )}
              </button>
            }
          />

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isWorking}
          >
            {pending === "signin" || pending === "signup" ? (
              <>
                <Spinner />
                {mode === "signin"
                  ? t.login.workingSignIn
                  : t.login.workingSignUp}
              </>
            ) : mode === "signin" ? (
              t.login.signIn
            ) : (
              t.login.signUp
            )}
          </Button>
        </form>

        <p className="pt-1 text-center text-sm text-muted">
          {mode === "signin" ? t.login.needAccount : t.login.haveAccount}{" "}
          <button
            type="button"
            onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
            className="font-medium text-accent underline-offset-4 transition-colors hover:text-accent-strong hover:underline"
          >
            {mode === "signin" ? t.login.toggleToSignUp : t.login.toggleToSignIn}
          </button>
        </p>
      </div>

      <p className="mt-8 flex items-center justify-center gap-2 text-center text-xs text-faint">
        <CheckCircleIcon className="size-3.5 shrink-0 text-accent/70" />
        {t.login.securedNote}
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className={cn(
        "size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80",
      )}
    />
  );
}
