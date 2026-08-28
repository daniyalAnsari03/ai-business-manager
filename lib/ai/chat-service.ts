import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/business/types";
import type { ChatAction } from "@/lib/ai/chat-protocol";
import { getUserBusiness } from "@/lib/business/service";
import {
  getServerUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";

/**
 * AI chat persistence service — the ONLY place that talks to Supabase about
 * AI conversations and messages. Ownership is always derived from the
 * authenticated server-side session (user -> owned business -> conversation.business_id);
 * RLS is the second enforcement layer.
 */

/* ---------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------ */

export interface AiConversation {
  id: string;
  businessId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Ambiguous candidates (WITH their real ids) stashed from the previous turn
   * so the agent can resolve a positional/attribute selection on the next turn.
   * Empty array when there is nothing pending. See docs/fix.txt.
   */
  pendingDisambiguation: PendingDisambiguation;
}

/**
 * A candidate list the agent presented but the user has not yet disambiguated.
 * `candidates` are the tool's own output objects (always include `id`).
 * Once the user's pick is translated to an exact id, `resolvedId` records it so
 * the following confirmation turn can re-use it without re-listing candidates.
 */
export interface PendingDisambiguation {
  tool: string;
  candidates: Array<Record<string, unknown> & { id: string }>;
  resolvedId?: string;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  businessId: string;
  role: "user" | "assistant";
  content: string;
  actions: ChatAction[];
  /** Permanent image URL (Supabase Storage) attached to a user message. */
  imageUrl?: string;
  createdAt: string;
}

export type ChatServiceError =
  | "unauthenticated"
  | "no_business"
  | "not_configured"
  | "not_found"
  | "database_error";

export type ChatServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ChatServiceError };

/* ---------------------------------------------------------------------------
 * DB row shapes (snake_case from Supabase)
 * ------------------------------------------------------------------------ */

interface ConversationRow {
  id: string;
  business_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  pending_disambiguation: unknown;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  business_id: string;
  role: "user" | "assistant";
  content: string;
  actions: unknown;
  image_url: string | null;
  created_at: string;
}

function parsePendingValue(input: unknown): unknown {
  // Accept both a proper jsonb object AND a jason-encoded string (some rows were
  // historically written as a jsonb STRING literal via JSON.stringify; the
  // PostgREST read of such a value returns typeof "string"). Normalize both.
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  }
  return input;
}

function mapPending(input: unknown): PendingDisambiguation {
  const empty: PendingDisambiguation = { tool: "", candidates: [] };
  const parsed = parsePendingValue(input);
  if (!parsed || typeof parsed !== "object") return empty;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.tool !== "string" || !Array.isArray(obj.candidates)) return empty;
  const candidates = obj.candidates.filter(
    (c): c is Record<string, unknown> & { id: string } =>
      !!c && typeof c === "object" && typeof (c as { id?: unknown }).id === "string",
  );
  const resolvedId =
    typeof obj.resolvedId === "string" && obj.resolvedId.length > 0
      ? obj.resolvedId
      : undefined;
  return { tool: obj.tool, candidates, resolvedId };
}

function mapConversation(row: ConversationRow): AiConversation {
  return {
    id: row.id,
    businessId: row.business_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pendingDisambiguation: mapPending(row.pending_disambiguation),
  };
}

function mapMessage(row: MessageRow): AiMessage {
  let actions: ChatAction[] = [];
  if (Array.isArray(row.actions)) {
    actions = row.actions as ChatAction[];
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    businessId: row.business_id,
    role: row.role,
    content: row.content,
    actions,
    imageUrl: row.image_url ?? undefined,
    createdAt: row.created_at,
  };
}

/* ---------------------------------------------------------------------------
 * Internal: resolve session + business (same pattern as products/service.ts)
 * ------------------------------------------------------------------------ */

async function requireBusinessContext(): Promise<
  | { ok: true; supabase: SupabaseClient; business: Business }
  | { ok: false; reason: ChatServiceError }
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

/* ---------------------------------------------------------------------------
 * Conversations
 * ------------------------------------------------------------------------ */

/**
 * List all conversations for the current business, newest first.
 * Returns summary data only (no messages) — suitable for the sidebar list.
 */
export async function listConversations(): Promise<
  ChatServiceResult<AiConversation[]>
> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("ai_conversations")
    .select("id, business_id, title, created_at, updated_at")
    .eq("business_id", context.business.id)
    .order("updated_at", { ascending: false });

  if (error) return { ok: false, reason: "database_error" };
  return {
    ok: true,
    data: ((data ?? []) as ConversationRow[]).map(mapConversation),
  };
}

/**
 * Fetch a single conversation with its full message history.
 * Validates ownership through the business context.
 */
export async function getConversation(
  conversationId: string,
): Promise<ChatServiceResult<{ conversation: AiConversation; messages: AiMessage[] }>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  // Fetch conversation — ownership enforced by RLS + business_id check.
  const { data: convData, error: convError } = await context.supabase
    .from("ai_conversations")
    .select("id, business_id, title, created_at, updated_at, pending_disambiguation")
    .eq("id", conversationId)
    .eq("business_id", context.business.id)
    .maybeSingle();

  if (convError) return { ok: false, reason: "database_error" };
  if (!convData) return { ok: false, reason: "not_found" };

  // Fetch messages ordered by creation time (ascending).
  const { data: msgData, error: msgError } = await context.supabase
    .from("ai_messages")
    .select("id, conversation_id, business_id, role, content, actions, image_url, created_at")
    .eq("conversation_id", conversationId)
    .eq("business_id", context.business.id)
    .order("created_at", { ascending: true });

  if (msgError) return { ok: false, reason: "database_error" };

  return {
    ok: true,
    data: {
      conversation: mapConversation(convData as ConversationRow),
      messages: ((msgData ?? []) as MessageRow[]).map(mapMessage),
    },
  };
}

/**
 * Create a new conversation. Called on the first message of a new chat.
 * The title is auto-generated from a truncated version of the first user message.
 */
export async function createConversation(
  firstMessage: string,
): Promise<ChatServiceResult<AiConversation>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const title = firstMessage.trim().slice(0, 80) || "New chat";

  const { data, error } = await context.supabase
    .from("ai_conversations")
    .insert({
      business_id: context.business.id,
      title,
    })
    .select("id, business_id, title, created_at, updated_at")
    .single();

  if (error) return { ok: false, reason: "database_error" };
  return { ok: true, data: mapConversation(data as ConversationRow) };
}

/**
 * Update a conversation's title.
 */
export async function updateConversationTitle(
  conversationId: string,
  title: string,
): Promise<ChatServiceResult<AiConversation>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const trimmed = title.trim().slice(0, 200);
  if (!trimmed) return { ok: false, reason: "database_error" };

  const { data, error } = await context.supabase
    .from("ai_conversations")
    .update({ title: trimmed })
    .eq("id", conversationId)
    .eq("business_id", context.business.id)
    .select("id, business_id, title, created_at, updated_at")
    .maybeSingle();

  if (error) return { ok: false, reason: "database_error" };
  if (!data) return { ok: false, reason: "not_found" };
  return { ok: true, data: mapConversation(data as ConversationRow) };
}

/**
 * Persist (or clear) the ambiguous-candidate list for a conversation so the
 * agent can resolve the user's next-turn selection to the exact record id.
 * Passing `null` clears any pending disambiguation (e.g. once resolved).
 */
export async function setPendingDisambiguation(
  conversationId: string,
  value: PendingDisambiguation | null,
): Promise<void> {
  const context = await requireBusinessContext();
  if (!context.ok) return;

  await context.supabase
    .from("ai_conversations")
    .update({
      // Send the object/array as-is. Do NOT JSON.stringify the value here: the
      // column is jsonb and PostgREST serializes plain JS objects/arrays into a
      // proper jsonb object. If we pre-serialized to a string, the value would
      // be stored as a jsonb STRING literal (double-encoded), so a later read
      // returns typeof "string" and mapPending would drop it as empty — which
      // silently broke cross-turn disambiguation ("pehla wala" always failed).
      pending_disambiguation: value ? value : [],
    })
    .eq("id", conversationId)
    .eq("business_id", context.business.id);
}
export async function deleteConversation(
  conversationId: string,
): Promise<ChatServiceResult<{ id: string }>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("ai_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("business_id", context.business.id)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, reason: "database_error" };
  if (!data) return { ok: false, reason: "not_found" };
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/* ---------------------------------------------------------------------------
 * Search
 * ------------------------------------------------------------------------ */

/**
 * Search conversations by title match OR message content match.
 * Returns matching conversations (deduplicated) ordered by most recent activity.
 * Used for the sidebar search input.
 */
export async function searchConversations(
  query: string,
): Promise<ChatServiceResult<AiConversation[]>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const term = query.trim();
  if (!term) return { ok: true, data: [] };

  // Strip PostgREST operator syntax characters from user input.
  const safeTerm = term.replace(/[,()%\\*]/g, " ").trim();
  if (!safeTerm) return { ok: true, data: [] };

  // Search by title match.
  const { data: titleMatches, error: titleError } = await context.supabase
    .from("ai_conversations")
    .select("id, business_id, title, created_at, updated_at")
    .eq("business_id", context.business.id)
    .ilike("title", `%${safeTerm}%`)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (titleError) return { ok: false, reason: "database_error" };

  // Search by message content match.
  const { data: contentMatches, error: contentError } = await context.supabase
    .from("ai_messages")
    .select("conversation_id")
    .eq("business_id", context.business.id)
    .ilike("content", `%${safeTerm}%`)
    .limit(50);

  if (contentError) return { ok: false, reason: "database_error" };

  // Collect unique conversation IDs from content matches.
  const contentConvIds = new Set(
    (contentMatches ?? []).map((m) => m.conversation_id as string),
  );

  // Remove content-match IDs that are already in title matches.
  const titleIds = new Set((titleMatches ?? []).map((c) => c.id));
  const extraIds = [...contentConvIds].filter((id) => !titleIds.has(id));

  if (extraIds.length === 0) {
    return {
      ok: true,
      data: ((titleMatches ?? []) as ConversationRow[]).map(mapConversation),
    };
  }

  // Fetch the extra conversations by ID.
  const { data: extraConvs, error: extraError } = await context.supabase
    .from("ai_conversations")
    .select("id, business_id, title, created_at, updated_at")
    .eq("business_id", context.business.id)
    .in("id", extraIds)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (extraError) return { ok: false, reason: "database_error" };

  // Merge and deduplicate, preserving recency order.
  const all = [
    ...((titleMatches ?? []) as ConversationRow[]),
    ...((extraConvs ?? []) as ConversationRow[]),
  ];
  const seen = new Set<string>();
  const deduped = all.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });

  return { ok: true, data: deduped.map(mapConversation) };
}

/* ---------------------------------------------------------------------------
 * Messages
 * ------------------------------------------------------------------------ */

/**
 * Save a user message to a conversation.
 */
export async function saveUserMessage(
  conversationId: string,
  content: string,
  imageUrl?: string,
): Promise<ChatServiceResult<AiMessage>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("ai_messages")
    .insert({
      conversation_id: conversationId,
      business_id: context.business.id,
      role: "user",
      content,
      image_url: imageUrl ?? null,
    })
    .select("id, conversation_id, business_id, role, content, actions, image_url, created_at")
    .single();

  if (error) return { ok: false, reason: "database_error" };
  return { ok: true, data: mapMessage(data as MessageRow) };
}

/**
 * Save an assistant message to a conversation (with its final actions).
 */
export async function saveAssistantMessage(
  conversationId: string,
  content: string,
  actions: ChatAction[],
): Promise<ChatServiceResult<AiMessage>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  const { data, error } = await context.supabase
    .from("ai_messages")
    .insert({
      conversation_id: conversationId,
      business_id: context.business.id,
      role: "assistant",
      content,
      actions: JSON.stringify(actions),
    })
    .select("id, conversation_id, business_id, role, content, actions, image_url, created_at")
    .single();

  if (error) return { ok: false, reason: "database_error" };
  return { ok: true, data: mapMessage(data as MessageRow) };
}

/**
 * Touch a conversation's updated_at timestamp (called after new messages).
 */
export async function touchConversation(
  conversationId: string,
): Promise<void> {
  const context = await requireBusinessContext();
  if (!context.ok) return;

  // updated_at is auto-set by the trigger, but an explicit update ensures
  // the row is touched even if only messages changed.
  await context.supabase
    .from("ai_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("business_id", context.business.id);
}

/**
 * Delete messages from a conversation starting after a given message ID (exclusive).
 * Used when editing a user message — truncates everything after it.
 */
export async function deleteMessagesAfter(
  conversationId: string,
  afterMessageId: string,
): Promise<ChatServiceResult<void>> {
  const context = await requireBusinessContext();
  if (!context.ok) return context;

  // First get the created_at of the "after" message to know the cutoff.
  const { data: cutoff, error: cutoffError } = await context.supabase
    .from("ai_messages")
    .select("created_at")
    .eq("id", afterMessageId)
    .eq("conversation_id", conversationId)
    .eq("business_id", context.business.id)
    .maybeSingle();

  if (cutoffError || !cutoff) return { ok: false, reason: "not_found" };

  // Delete all messages in this conversation created strictly after the cutoff.
  const { error } = await context.supabase
    .from("ai_messages")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("business_id", context.business.id)
    .gt("created_at", cutoff.created_at);

  if (error) return { ok: false, reason: "database_error" };
  return { ok: true, data: undefined };
}
