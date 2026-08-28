"use server";

import { completeBusinessSetup } from "@/lib/business/service";

export type SetupActionState = {
  ok: boolean;
  reason?: "unauthenticated" | "invalid_input" | "not_configured" | "database_error";
};

/**
 * Server action behind the Business Setup form. Ownership is derived from
 * the authenticated session inside the service — never from form data.
 */
export async function completeBusinessSetupAction(
  input: unknown,
): Promise<SetupActionState> {
  const result = await completeBusinessSetup(input);
  return { ok: result.ok, reason: result.reason };
}
