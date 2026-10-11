import { state } from "./state.mjs";

/** Stand-in for lib/marketing/automation: mode comes from test state. */
export async function getAutomationMode() {
  return state.automationModeResult ?? { ok: true, data: "needs_approval" };
}