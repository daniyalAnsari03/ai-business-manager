"use server";

import {
  getAutomationMode,
  setAutomationMode,
  type AutomationServiceError,
} from "@/lib/marketing/automation";
import type { AutomationMode } from "@/lib/marketing/approval-types";

export type AutomationModeActionState =
  | { ok: true; mode: AutomationMode }
  | { ok: false; reason: AutomationServiceError };

/** Reads the business's current automation mode. */
export async function getAutomationModeAction(): Promise<AutomationModeActionState> {
  const result = await getAutomationMode();
  return result.ok ? { ok: true, mode: result.data } : { ok: false, reason: result.reason };
}

/** Sets the automation mode (needs_approval | full_auto), persisted in Supabase. */
export async function setAutomationModeAction(
  mode: AutomationMode,
): Promise<AutomationModeActionState> {
  const result = await setAutomationMode(mode);
  return result.ok ? { ok: true, mode: result.data } : { ok: false, reason: result.reason };
}
