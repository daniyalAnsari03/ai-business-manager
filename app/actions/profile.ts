"use server";

import { isLanguage } from "@/lib/business/types";
import { updateBusinessLanguage } from "@/lib/business/service";
import { updatePreferredLanguage } from "@/lib/profiles/service";

export type LanguageActionState = {
  ok: boolean;
  reason?: "unauthenticated" | "invalid_input" | "not_configured" | "database_error";
};

/**
 * Saves the account-wide language choice. The user profile is updated
 * first; when a business exists its language is kept in sync so every
 * future session starts in the selected language.
 */
export async function updateLanguagePreferenceAction(
  input: unknown,
): Promise<LanguageActionState> {
  const result = await updatePreferredLanguage(input);
  if (!result.ok) return result;

  if (typeof input === "string" && isLanguage(input)) {
    // Best-effort mirror — the profile choice above stays authoritative and
    // must not be blocked if no business exists yet or the sync fails.
    try {
      await updateBusinessLanguage(input);
    } catch {
      // Ignore mirror failures.
    }
  }

  return { ok: true };
}
