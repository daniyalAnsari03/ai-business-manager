import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import type { AutomationMode } from "@/lib/marketing/approval-types";
import { AUTOMATION_MODES } from "@/lib/marketing/approval-types";

/**
 * Automation settings service — the ONLY place that talks to Supabase about
 * `automation_settings`. Ownership is always derived from the authenticated
 * server-side session (user → owned business → row.business_id); RLS is the
 * second enforcement layer.
 *
 * The default is `needs_approval` (safe). A business only reaches `full_auto`
 * after its owner deliberately switches the automation control.
 */

export type AutomationServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "invalid_input"
  | "database_error";

export type AutomationServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: AutomationServiceError };

/** Resolves the caller's session + owned business, or a failure reason. */
async function requireBusinessContext(): Promise<
  | { ok: true; supabase: SupabaseClient; business: Business }
  | { ok: false; reason: AutomationServiceError }
> {
  let user;
  let supabase: SupabaseClient;
  try {
    user = await getServerUser();
    supabase = await getSupabaseServerClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }
  if (!user) return { ok: false, reason: "unauthenticated" };

  const business = await getUserBusiness();
  if (!business) return { ok: false, reason: "no_business" };
  return { ok: true, supabase, business };
}

interface AutomationRow {
  id: string;
  business_id: string;
  mode: string;
  created_at: string;
  updated_at: string;
}

function isMode(value: string): value is AutomationMode {
  return (AUTOMATION_MODES as readonly string[]).includes(value);
}

/**
 * The business's current automation mode. Returns `needs_approval` when no
 * row exists yet (safe default) rather than fabricating a full-auto state.
 */
export async function getAutomationMode(): Promise<
  AutomationServiceResult<AutomationMode>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("automation_settings")
    .select("mode")
    .eq("business_id", context.business.id)
    .maybeSingle();

  if (error) return { ok: false, reason: "database_error" };

  const row = data as AutomationRow | null;
  const mode: AutomationMode =
    row && isMode(row.mode) ? row.mode : "needs_approval";
  return { ok: true, data: mode };
}

/**
 * Sets the automation mode. Only `needs_approval` and `full_auto` are valid.
 * The row is upserted on business_id so a fresh business always has an
 * explicit, persisted choice.
 */
export async function setAutomationMode(
  mode: unknown,
): Promise<AutomationServiceResult<AutomationMode>> {
  if (!isMode(String(mode))) {
    return { ok: false, reason: "invalid_input" };
  }

  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("automation_settings")
    .upsert(
      { business_id: context.business.id, mode },
      { onConflict: "business_id" },
    )
    .select("mode")
    .single();

  if (error || !data) return { ok: false, reason: "database_error" };

  const row = data as AutomationRow;
  const saved: AutomationMode = isMode(row.mode) ? row.mode : "needs_approval";
  return { ok: true, data: saved };
}
