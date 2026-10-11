/**
 * Stand-in for lib/marketing/publish so the approval-executors module loads
 * offline without pulling in the Meta publishing SDK paths. Not used by any
 * test in this phase (money executors are what we exercise).
 */
export async function publishPost() {
  return { ok: false, error: "not_configured" };
}