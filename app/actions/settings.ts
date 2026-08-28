"use server";

import { updateBusinessProfile } from "@/lib/business/service";
import type { Business } from "@/lib/business/types";

export type SettingsActionState =
  | { ok: true; business: Business }
  | {
      ok: false;
      reason:
        | "unauthenticated"
        | "invalid_input"
        | "not_configured"
        | "database_error";
    };

/**
 * Server action behind the Business Settings form. Ownership is derived
 * from the authenticated session inside the service — never from form data.
 */
export async function updateBusinessSettingsAction(
  input: unknown,
): Promise<SettingsActionState> {
  const result = await updateBusinessProfile(input);
  if (result.ok && result.business) {
    return { ok: true, business: result.business };
  }
  return { ok: false, reason: result.reason ?? "database_error" };
}
