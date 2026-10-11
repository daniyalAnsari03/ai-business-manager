import "server-only";

import type { AgentRunContext } from "@/lib/ai/context";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Writer for `public.audit_logs` — the single "who changed what, when and why"
 * history that does not depend on any one module remembering to log itself.
 *
 * Only the SERVER writes here, through the service-role client (the table
 * grants `authenticated` SELECT only, so no browser, client SDK or agent tool
 * can forge, rewrite or erase history). Rows are append-only.
 *
 * `business_id` is ALWAYS taken from the server-side AgentRunContext. The model
 * never supplies it, so a tool can only ever record against the business of the
 * session that is executing it.
 *
 * IMPORTANT: an audit failure is a REPORTING failure, never a business-action
 * failure. The business change has already been confirmed by the backend by the
 * time this is called, so losing the row must not undo it or fail the tool. We
 * log a clear server-side error (no secrets) and continue — a tool must never
 * tell the user an audit was written when it was not.
 */

export type AuditActorType = "user" | "ai" | "system" | "webhook";

/** A before/after state snapshot. Deliberately small and non-sensitive. */
export type AuditSnapshot = Record<string, unknown>;

export interface AuditLogEntry {
  /** Server-derived business that owns the record. Never model input. */
  businessId: string;
  actorType: AuditActorType;
  /** Profile/auth uid of the human on whose behalf the AI acted, if known. */
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: AuditSnapshot | null;
  after?: AuditSnapshot | null;
  reason?: string | null;
  /** Trace id shared by every row written during one chat request/turn. */
  correlationId?: string | null;
}

export type AuditLogResult = { ok: true } | { ok: false; error: string };

const ACTOR_TYPES: readonly string[] = ["user", "ai", "system", "webhook"];

const MAX_UUID_CHARS = 36;
const MAX_ACTION_CHARS = 100;
const MAX_ENTITY_CHARS = 60;
const MAX_REASON_CHARS = 2000;
const MAX_CORRELATION_ID_CHARS = 160;

/* ---------------------------------------------------------------------------
 * Snapshot hygiene
 *
 * Snapshots are a record of WHAT changed, not a data dump. They are bounded in
 * size and stripped of anything secret or personal, so an audit row can never
 * become a second copy of customer PII or a leaked credential.
 * ------------------------------------------------------------------------ */

const MAX_STRING_CHARS = 200;
const MAX_ARRAY_ITEMS = 25;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 4;
const REDACTED = "[redacted]";

/** Matched (case-insensitively) against snapshot key names. */
const BLOCKED_KEY_PARTS: readonly string[] = [
  // secrets / credentials
  "token",
  "secret",
  "password",
  "passwd",
  "credential",
  "authorization",
  "cookie",
  "session",
  "api_key",
  "apikey",
  "private_key",
  "access_key",
  "signature",
  "otp",
  "cvv",
  "card_number",
  // personal data the log has no business holding
  "phone",
  "email",
  "address",
  "contact",
  "national_id",
  "cnic",
  "date_of_birth",
  "latitude",
  "longitude",
];

function isBlockedKey(key: string): boolean {
  const needle = key.toLowerCase();
  return BLOCKED_KEY_PARTS.some((part) => needle.includes(part));
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return value.length > MAX_STRING_CHARS
      ? `${value.slice(0, MAX_STRING_CHARS)}…`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return null;
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return null;
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
    for (const [key, item] of entries) {
      out[key] = isBlockedKey(key) ? REDACTED : sanitizeValue(item, depth + 1);
    }
    return out;
  }
  return null;
}

function boundedText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function boundedSnapshot(value: AuditSnapshot | null | undefined): AuditSnapshot | null {
  if (!value || typeof value !== "object") return null;
  return sanitizeValue(value, 0) as AuditSnapshot;
}

/**
 * Inserts exactly one audit_logs row through the service-role client.
 * Never throws: an audit problem is reported, not propagated.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<AuditLogResult> {
  try {
    const businessId = boundedText(entry.businessId, MAX_UUID_CHARS);
    const action = boundedText(entry.action, MAX_ACTION_CHARS);
    const entity = boundedText(entry.entity, MAX_ENTITY_CHARS);
    if (!businessId || !action || !entity) {
      return { ok: false, error: "invalid_entry_missing_business_id_action_or_entity" };
    }
    if (!ACTOR_TYPES.includes(entry.actorType)) {
      return { ok: false, error: "invalid_actor_type" };
    }

    const admin = await getSupabaseAdminClient();
    if (!admin) {
      return { ok: false, error: "service_role_client_unavailable" };
    }

    const { error } = await admin.from("audit_logs").insert({
      business_id: businessId,
      actor_type: entry.actorType,
      actor_id: boundedText(entry.actorId, MAX_UUID_CHARS),
      action,
      entity,
      entity_id: boundedText(entry.entityId, MAX_UUID_CHARS),
      before: boundedSnapshot(entry.before),
      after: boundedSnapshot(entry.after),
      reason: boundedText(entry.reason, MAX_REASON_CHARS),
      correlation_id: boundedText(entry.correlationId, MAX_CORRELATION_ID_CHARS),
    });

    if (error) {
      return { ok: false, error: `insert_failed: ${error.message}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** What a tool reports about an action it has just completed successfully. */
export interface AgentAuditEvent {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: AuditSnapshot | null;
  after?: AuditSnapshot | null;
  reason?: string | null;
}

/**
 * Tool-facing entry point. Binds the audit row to the SERVER-SIDE run context
 * (business + acting user + request correlation id) so no tool can ever choose
 * the business it writes to, and resolves nothing from model input.
 *
 * Call this ONLY after the backend has confirmed the business action. A failed,
 * rejected, or still-unconfirmed action must not be recorded.
 *
 * Resolves to nothing and never throws: on failure it logs a clear server-side
 * error so the gap is visible, while the completed business action stands.
 */
export async function recordAgentAudit(
  context: AgentRunContext | null,
  event: AgentAuditEvent,
): Promise<void> {
  const businessId = context?.businessId;
  if (typeof businessId !== "string" || !businessId.trim()) {
    console.error(
      "[audit] NOT WRITTEN: missing server-side run context (businessId), so the row could not be attributed safely.",
      "action=",
      event.action,
      "entity=",
      event.entity,
    );
    return;
  }

  const result = await writeAuditLog({
    businessId,
    actorType: "ai",
    actorId: context?.userId ?? null,
    action: event.action,
    entity: event.entity,
    entityId: event.entityId ?? null,
    before: event.before ?? null,
    after: event.after ?? null,
    reason: event.reason ?? null,
    correlationId: context?.correlationId ?? null,
  });

  if (!result.ok) {
    console.error(
      `[audit] NOT WRITTEN for ${event.action} on ${event.entity}${
        event.entityId ? ` (${event.entityId})` : ""
      }: ${result.error}. The business action itself already succeeded, so this history row is missing.`,
    );
  }
}
