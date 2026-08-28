import "server-only";

import {
  assistant as assistantMessage,
  MaxTurnsExceededError,
  ModelBehaviorError,
  run,
  UserError,
  user as userMessage,
} from "@openai/agents";
import { NextResponse } from "next/server";

import { createBusinessManagerAgent, BUSINESS_MANAGER_MAX_TURNS } from "@/lib/ai/agent";
import { isLanguage, type Language } from "@/lib/business/types";
import { getCurrency } from "@/lib/business/constants";
import type { AgentRunContext } from "@/lib/ai/context";
import type {
  ChatAction,
  ChatErrorCode,
  ChatMessageDto,
  ChatStreamEvent,
} from "@/lib/ai/chat-protocol";
import type { PendingDisambiguation } from "@/lib/ai/chat-service";
import { resolveSelectionToId } from "@/lib/ai/disambiguation-resolver";
import { isPendingRelevant } from "@/lib/ai/disambiguation-relevance";
import {
  GeminiRouterError,
  findErrorInCauseChain,
} from "@/lib/ai/gemini-router";
import { GroqProviderError } from "@/lib/ai/groq-provider";
import { OpenAiProviderError } from "@/lib/ai/openai-provider";
import { isAiConfigured } from "@/lib/ai/gemini-config";
import {
  decideEmptyFinalOutput,
  decideRunFailure,
  type RecoveryState,
} from "@/lib/ai/run-recovery";
import {
  createConversation,
  getConversation,
  saveUserMessage,
  saveAssistantMessage,
  setPendingDisambiguation,
  touchConversation,
} from "@/lib/ai/chat-service";
import { getUserBusiness } from "@/lib/business/service";
import { getServerUser } from "@/lib/supabase/server";

/**
 * AI Business Manager chat endpoint (server-only).
 *
 * - Authenticates the caller from the server session; business context is
 *   derived from ownership, never from the request body.
 * - Streams simplified lifecycle events (status / action / done / error) as
 *   Server-Sent Events. Internal tool names and provider details never
 *   reach the client — only stable, localizable action codes.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------------------------------------------------------------------
 * Request validation
 * ------------------------------------------------------------------------ */

const MAX_HISTORY_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4000;
const MAX_USER_MESSAGE_CHARS = 2000;

interface ParsedChatRequest {
  history: ChatMessageDto[];
  userMessage: string;
  language: Language;
  conversationId?: string;
  imageUrl?: string;
}

function parseChatRequest(raw: unknown): ParsedChatRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;

  const language =
    typeof body.language === "string" && isLanguage(body.language)
      ? body.language
      : null;
  if (!language) return null;

  const userMessage =
    typeof body.message === "string" ? body.message.trim() : "";
  if (!userMessage || userMessage.length > MAX_USER_MESSAGE_CHARS) return null;

  if (!Array.isArray(body.history)) return null;
  const history: ChatMessageDto[] = [];
  for (const entry of body.history.slice(-MAX_HISTORY_MESSAGES)) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const role = item.role === "user" || item.role === "assistant" ? item.role : null;
    if (!role) continue;
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content || content.length > MAX_MESSAGE_CHARS) continue;
    history.push({ role, content });
  }

  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.trim()
      ? body.conversationId.trim()
      : undefined;

  const imageUrl =
    typeof body.imageUrl === "string" && body.imageUrl.trim().startsWith("http")
      ? body.imageUrl.trim()
      : undefined;

  return { history, userMessage, language, conversationId, imageUrl };
}

/* ---------------------------------------------------------------------------
 * Basic per-user abuse guard (in-memory sliding window)
 * ------------------------------------------------------------------------ */

const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 20;

const recentCalls = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const stamps = (recentCalls.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (stamps.length >= WINDOW_LIMIT) {
    recentCalls.set(userId, stamps);
    return true;
  }
  stamps.push(now);
  recentCalls.set(userId, stamps);
  // Opportunistic cleanup so the map cannot grow unbounded.
  if (recentCalls.size > 500) {
    for (const [key, times] of recentCalls) {
      if (times.every((t) => now - t >= WINDOW_MS)) recentCalls.delete(key);
    }
  }
  return false;
}

/* ---------------------------------------------------------------------------
 * Action-code mapping (stable UI codes — tool names stay server-side)
 * ------------------------------------------------------------------------ */

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

const ACTION_BY_TOOL: Record<
  string,
  { code: ChatAction["code"]; paramsFrom: string[][] }
> = {
  create_product: { code: "product_created", paramsFrom: [["name"]] },
  update_product: { code: "product_updated", paramsFrom: [["name", "productName"]] },
  set_product_stock: { code: "stock_updated", paramsFrom: [["name", "productName"]] },
  adjust_product_stock: { code: "stock_updated", paramsFrom: [["name", "productName"]] },
  delete_product: { code: "product_removed", paramsFrom: [["name", "productName"]] },
  create_customer: { code: "customer_added", paramsFrom: [["name"]] },
  update_customer: { code: "customer_updated", paramsFrom: [["name", "customerName"]] },
  delete_customer: { code: "customer_removed", paramsFrom: [["name", "customerName"]] },
  create_order: { code: "order_created", paramsFrom: [["orderNumber"]] },
  update_order_status: {
    code: "order_status_changed",
    // The tool reports the authoritative new status under `newStatus` (the bare
    // `status` key is the toolOk success sentinel "ok" and is skipped by
    // extractParams). Reading `newStatus` makes the pill show the REAL status
    // (completed/cancelled/pending) instead of always "pending" (docs/fix.txt).
    paramsFrom: [["orderNumber"], ["status", "newStatus"]],
  },
  create_expense: { code: "expense_added", paramsFrom: [["title", "name"]] },
  update_expense: { code: "expense_updated", paramsFrom: [["title", "expenseTitle"]] },
  delete_expense: { code: "expense_removed", paramsFrom: [["title", "expenseTitle"]] },
  update_business_profile: {
    code: "business_updated",
    paramsFrom: [["name"]],
  },
};

function parseJsonSafe(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractParams(
  mapping: { paramsFrom: string[][] },
  args: Record<string, unknown>,
  output: Record<string, unknown> | null,
): Record<string, string> | undefined {
  const params: Record<string, string> = {};
  for (const keyCandidates of mapping.paramsFrom) {
    for (const key of keyCandidates) {
      const value =
        firstString(output ?? {}, [key]) ?? firstString(args, [key]);
      // toolOk reserves `status: "ok"` as its success sentinel. When a mapping
      // wants the order's REAL status ({"status","newStatus"}), "ok" must be
      // skipped so it cannot masquerade as the new status (docs/fix.txt).
      if (value && value !== "ok") {
        params[keyCandidates[0]] = value;
        break;
      }
    }
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

/* ---------------------------------------------------------------------------
 * Error classification → safe client codes
 * ------------------------------------------------------------------------ */

function findRouterError(error: unknown): GeminiRouterError | GroqProviderError | null {
  return findErrorInCauseChain<GeminiRouterError | GroqProviderError>(
    error,
    (candidate) =>
      candidate instanceof GeminiRouterError || candidate instanceof GroqProviderError,
  );
}

function classifyRunError(error: unknown): ChatErrorCode {
  const routerError = findRouterError(error);
  if (routerError) {
    if (routerError instanceof GroqProviderError) {
      switch (routerError.code) {
        case "rate_limited":
          return "ai_overloaded";
        case "auth_failed":
          return "provider_auth";
        // Config-level Groq problems (missing model, bad request shape):
        // the AI service cannot serve right now — safe generic codes only.
        default:
          return "try_again";
      }
    }
    switch (routerError.code) {
      case "rate_limited":
        return "ai_overloaded";
      case "auth_failed":
        return "provider_auth";
      case "not_configured":
        return "ai_not_configured";
      default:
        return "try_again";
    }
  }
  if (error instanceof OpenAiProviderError) {
    switch (error.code) {
      case "auth_failed":
        return "provider_auth";
      case "insufficient_balance":
      case "rate_limited":
        return "ai_overloaded";
      default:
        return "try_again";
    }
  }
  if (
    error instanceof MaxTurnsExceededError ||
    error instanceof ModelBehaviorError ||
    error instanceof UserError
  ) {
    return "response_incomplete";
  }
  return "try_again";
}

/* ---------------------------------------------------------------------------
 * SSE helpers
 * ------------------------------------------------------------------------ */

function sseChunk(event: ChatStreamEvent | "[DONE]"): Uint8Array {
  const payload = event === "[DONE]" ? "[DONE]" : JSON.stringify(event);
  return new TextEncoder().encode(`data: ${payload}\n\n`);
}

/* ---------------------------------------------------------------------------
 * Route handler
 * ------------------------------------------------------------------------ */

export async function POST(request: Request): Promise<Response> {
  // 1) Authentication + business ownership come ONLY from the session.
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthenticated" satisfies ChatErrorCode } },
      { status: 401 },
    );
  }

  const business = await getUserBusiness();
  if (!business?.setupCompleted) {
    return NextResponse.json(
      { error: { code: "unauthenticated" satisfies ChatErrorCode } },
      { status: 403 },
    );
  }

  // 2) Request shape.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_input" satisfies ChatErrorCode } },
      { status: 400 },
    );
  }
  const parsed = parseChatRequest(rawBody);
  if (!parsed) {
    return NextResponse.json(
      { error: { code: "invalid_input" satisfies ChatErrorCode } },
      { status: 400 },
    );
  }

  // 3) AI availability + abuse guard.
  if (!isAiConfigured()) {
    return Response.json(
      { error: { code: "ai_not_configured" satisfies ChatErrorCode } },
      { status: 503 },
    );
  }
  if (isRateLimited(user.id)) {
    return NextResponse.json(
      { error: { code: "busy" satisfies ChatErrorCode } },
      { status: 429 },
    );
  }

  // 4) Run the agent server-side and stream simplified events.

  // Resolve conversation history from DB if a conversationId was provided.
  // The client-supplied `history` is NOT trusted when a conversationId exists;
  // we load the authoritative record from the database instead.
  let activeConversationId = parsed.conversationId;
  let dbHistory: ChatMessageDto[] = parsed.history;
  let pendingDisambiguation: PendingDisambiguation = { tool: "", candidates: [] };

  if (activeConversationId) {
    const convResult = await getConversation(activeConversationId);
    if (!convResult.ok) {
      return NextResponse.json(
        { error: { code: "invalid_input" satisfies ChatErrorCode } },
        { status: 400 },
      );
    }
    // Use the DB messages as the authoritative history (last 30).
    dbHistory = convResult.data.messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Carry forward any ambiguous candidates stashed on the previous turn
    // (docs/fix.txt: the agent needs the candidate ids to resolve the user's
    // next-turn pick like "pehla"/"first"/"clothing wala" to the exact id).
    pendingDisambiguation = convResult.data.conversation.pendingDisambiguation;
  }

  // Create the conversation BEFORE the stream starts so the ID is available
  // for the `done` event. This prevents the frontend from never receiving
  // a conversation ID (which caused chat history fragmentation).
  if (!activeConversationId) {
    const convResult = await createConversation(parsed.userMessage);
    if (convResult.ok) {
      activeConversationId = convResult.data.id;
      console.log("[ai-chat] created conversation:", activeConversationId);
    } else {
      console.error("[ai-chat] failed to create conversation before stream:", convResult.reason);
    }
    // Non-fatal: if creation fails, persistence will retry later.
  }

  const context: AgentRunContext = {
    businessId: business.id,
    businessName: business.name,
    businessType: business.businessType,
    currencyCode: business.currency,
    currencySymbol: getCurrency(business.currency)?.symbol ?? business.currency,
    language: parsed.language,
    imageUrl: parsed.imageUrl,
  };

  const agent = createBusinessManagerAgent(context);
  const input = [
    ...dbHistory.map((message) =>
      message.role === "user"
        ? userMessage(message.content)
        : assistantMessage(message.content),
    ),
    userMessage(parsed.userMessage),
  ];

  // Build a hidden context block appended to the current user turn. It is NOT
  // persisted (persistMessages saves the raw parsed.userMessage), so the user
  // never sees these instructions — they exist only so the model has the data
  // it needs to act correctly this turn.
  const contextNotes: string[] = [];

  // When an image is attached, tell the agent about the image URL so it can
  // pass it to create_product / update_product.
  if (parsed.imageUrl) {
    contextNotes.push(
      `[ATTACHED IMAGE URL: ${parsed.imageUrl}]\n` +
        "If this message is about creating or updating a product, use the imageUrl parameter when calling create_product or update_product tools with the URL shown above. " +
        "If the message is unrelated to products, ignore the image and answer normally."
    );
  }

  // Carry-forward disambiguation (docs/fix.txt): if the previous turn left the
  // agent with ambiguous candidates, the user's reply is likely a selection, so
  // we hand back the candidate ids / resolved id. BUT the pending state must
  // only be trusted when the current user message actually refers to it. If the
  // user instead opened a fresh, unrelated request, folding the stale state into
  // the turn would let a previously-resolved id / leftover candidate list bleed
  // across turns and silently steer the agent toward one record without
  // re-surfacing that multiple matches exist (docs/fix.txt priority bug).
  const hasCandidates = pendingDisambiguation.candidates.length > 0;
  const hasResolvedId = Boolean(pendingDisambiguation.resolvedId);

  const pendingIsRelevant = isPendingRelevant(
    parsed.userMessage,
    pendingDisambiguation,
  );

  // Server-deterministic target captured from this turn's user pick. When the
  // route itself maps "pehla wala"/"clothing wala" to an exact id, we remember
  // it here and fold it into the run's `resolvedTarget` so the confirmation
  // turn carries it even if the model omits the id parameter.
  let serverResolvedTarget: { tool: string; id: string } | null = null;

  // Diagnostic (docs/fix.txt §point 1): log the stored candidate list that was
  // actually loaded for this conversation at this decision point, so a failed
  // id lookup can be traced to an empty/stale list vs a model/echo problem. Log
  // the relevance decision so a silent-pick regression can be traced to whether
  // we (wrongly) carried stale state vs the model ignoring a real ambiguity.
  console.log(
    "[disambiguation] turn start -> pendingDisambiguation",
    JSON.stringify({
      loadedConversationId: activeConversationId ?? null,
      hasCandidates,
      hasResolvedId,
      pendingIsRelevant,
      userMessage: parsed.userMessage,
      tool: pendingDisambiguation.tool,
      candidateCount: pendingDisambiguation.candidates.length,
      candidateIds: pendingDisambiguation.candidates.map((c) => c.id),
      resolvedId: pendingDisambiguation.resolvedId ?? null,
    }),
  );

  if (hasCandidates && pendingIsRelevant) {
    // Determine the exact target id ON THE SERVER when the user's short reply
    // deterministically maps to one of the listed candidates. When it does, we
    // hand the model a single authoritative id (rather than the whole blob of
    // uuids it might mangle), which is what makes the pick reliable end-to-end
    // even across a long disambiguate -> confirm flow.
    const serverResolvedId = resolveSelectionToId(
      parsed.userMessage,
      pendingDisambiguation,
    );

    if (serverResolvedId) {
      console.log(
        "[disambiguation] SERVER-resolved user pick to id:",
        JSON.stringify(serverResolvedId),
      );
      serverResolvedTarget = {
        tool: pendingDisambiguation.tool,
        id: serverResolvedId,
      };
      contextNotes.push(
        "HIDDEN CONTEXT — the user is picking among the candidates you listed last turn. The selection below has ALREADY been mapped to exactly one record on the server. " +
          `When you act, re-call the tool "${pendingDisambiguation.tool}" and pass the id parameter (productId / customerId / expenseId / orderId) EXACTLY equal to "${serverResolvedId}" — do NOT re-search by name, do NOT invent or alter the id. ` +
          `If the user then confirms, re-call the same tool with confirmed=true and the SAME id.`
      );
    } else {
      contextNotes.push(
        "HIDDEN CONTEXT — your previous turn listed unresolved candidate matches and the user has now replied (likely picking one by position like 'pehla'/'first'/'doosra'/'second', or by an attribute you mentioned). " +
          `Re-call the tool "${pendingDisambiguation.tool}" and pass the EXACT id of the chosen candidate in its id parameter (productId / customerId / expenseId / orderId) — do NOT re-search by name, which hits the same ambiguity. ` +
          `Candidate ids -> details: ${JSON.stringify(pendingDisambiguation.candidates)}`
      );
    }
  } else if (hasResolvedId && pendingIsRelevant) {
    // The user already picked a specific record last turn and is now confirming
    // it. Give the agent the exact id again so it can complete the action
    // without re-listing or re-guessing.
    contextNotes.push(
      "HIDDEN CONTEXT — last turn you identified the exact record the user means and the user has now confirmed. " +
        `When you act, re-call the tool "${pendingDisambiguation.tool}" with its id parameter set to "${pendingDisambiguation.resolvedId}" (productId / customerId / expenseId / orderId) to target that exact record.`
    );
  } else if (hasCandidates || hasResolvedId) {
    // Stale disambiguation: the pending state does NOT belong to this turn's
    // request. Do NOT fold it in — the model must treat this as a fresh query
    // and run a real search (which re-surfaces any genuine ambiguity). Logging
    // here lets us confirm the stale state was dropped rather than silently
    // steering the turn.
    console.log(
      "[disambiguation] DROPPING stale pending state (not relevant to this turn) — tool:",
      pendingDisambiguation.tool,
      "| candidates:",
      pendingDisambiguation.candidates.length,
      "| resolvedId:",
      pendingDisambiguation.resolvedId ?? null,
    );
  }

  if (contextNotes.length > 0) {
    const lastIdx = input.length - 1;
    if (lastIdx >= 0) {
      input[lastIdx] = userMessage(
        parsed.userMessage + "\n\n" + contextNotes.join("\n\n"),
      );
    }
  }

  /**
   * Runs the agent once and streams its lifecycle events. Tool outcomes are
   * recorded into `actions` so a later recovery step can confirm what the
   * database actually accepted even if the model/provider dies afterwards.
   * Nothing here re-executes tools: retries rebuild the conversation from the
   * SAME input, and they are only ever allowed when no mutation tool started.
   */
  const runOnce = async (
    enqueue: (event: ChatStreamEvent | "[DONE]") => void,
    actions: ChatAction[],
    signal: AbortSignal,
  ): Promise<
    { ok: true; finalText: string } | { ok: false; mode: "empty" }
  > => {
    enqueue({ type: "status", phase: "thinking" });

    const result = await run(agent, input, {
      stream: true,
      context,
      maxTurns: BUSINESS_MANAGER_MAX_TURNS,
      signal,
    });

    for await (const event of result) {
      // Stream text deltas as they arrive for progressive rendering.
      if (event.type === "raw_model_stream_event") {
        const data = event.data;
        if (data.type === "output_text_delta" && typeof data.delta === "string") {
          enqueue({ type: "text_delta", delta: data.delta });
        }
        continue;
      }

      if (event.type !== "run_item_stream_event") continue;

      if (event.name === "tool_called") {
        const callItem = event.item as unknown as {
          rawItem?: { name?: string; arguments?: string };
        };
        const toolName = callItem.rawItem?.name ?? "";
        const mapping = ACTION_BY_TOOL[toolName];
        if (!mapping) continue; // Read tools are not surfaced as actions.

        const args =
          parseJsonSafe(callItem.rawItem?.arguments) ??
          ({} as Record<string, unknown>);

        // If the agent targets a record by its exact id (rather than by name),
        // remember that resolution so the NEXT turn (e.g. the confirmation
        // turn) can reuse the same id instead of losing it (docs/fix.txt).
        const idFromArgs =
          typeof args.productId === "string" && args.productId
            ? args.productId
            : typeof args.customerId === "string" && args.customerId
              ? args.customerId
              : typeof args.expenseId === "string" && args.expenseId
                ? args.expenseId
                : typeof args.orderId === "string" && args.orderId
                  ? args.orderId
                  : null;
        if (idFromArgs) {
          resolvedTarget = { tool: toolName, id: idFromArgs };
        }

        // Diagnostic (docs/fix.txt §point 2): log the FULL raw tool-call
        // arguments for every actionable tool so we can see whether the model
        // actually passed the id parameter (productId/customerId/etc) on the
        // "pehla wala"/"clothing wala"/confirmation turns, or fell back to a
        // name/query search that re-hits the ambiguity.
        console.log(
          `[ai-chat] DIAGNOSTIC tool_called=${toolName} raw args:`,
          JSON.stringify(args, null, 2),
        );
        console.log(
          `[ai-chat] DIAGNOSTIC tool_called=${toolName} id parameter present:`,
          idFromArgs ? "YES (" + idFromArgs + ")" : "NO",
          "| name/query present:",
          (typeof args.productName === "string" && args.productName) ||
            (typeof args.query === "string" && args.query)
            ? "YES"
            : "NO",
        );
        const action: Omit<ChatAction, "id"> = {
          code: mapping.code,
          phase: "started",
          params: extractParams(mapping, args, null),
        };
        actions.push({ id: `${toolName}-started-${actions.length}`, ...action });
        enqueue({ type: "action", action });
        enqueue({ type: "status", phase: "checking_data" });
        continue;
      }

      if (event.name === "tool_output") {
        const outputItem = event.item as unknown as {
          rawItem?: { name?: string };
          output?: unknown;
        };
        const toolName = outputItem.rawItem?.name ?? "";
        const output = parseJsonSafe(outputItem.output);
        console.log(
          "[route][tool_output]",
          toolName,
          "rawOutputType=",
          typeof outputItem.output,
          "parsedStatus=",
          output?.status,
          "raw=",
          typeof outputItem.output === "string"
            ? outputItem.output.slice(0, 300)
            : JSON.stringify(outputItem.output)?.slice(0, 300),
        );

        // Capture ambiguous candidates (with ids) so we can stash them on the
        // conversation and hand them back next turn (docs/fix.txt). This MUST
        // run for EVERY tool — including read-only ones like find_product,
        // find_customer and get_customer_orders which are not surfaceable
        // actions and therefore not in ACTION_BY_TOOL. Skipping them (as the
        // earlier action-bounded guard did) lost the candidate list on read-based
        // ambiguity, so the next-turn "pehla/number wala" pick had no ids and
        // the agent fell back to an invented id (e.g. "prod_1") that always
        // resolved NOT_FOUND.
        if (
          output?.status === "needs_clarification" &&
          Array.isArray(output.candidates) &&
          output.candidates.length > 0
        ) {
          pendingClarification = {
            tool: toolName,
            candidates: output.candidates.filter(
              (c: unknown): c is Record<string, unknown> & { id: string } =>
                !!c &&
                typeof c === "object" &&
                typeof (c as { id?: unknown }).id === "string",
            ),
          };
          console.log(
            "[disambiguation] captured needs_clarification candidates for tool",
            toolName,
            "(count",
            pendingClarification.candidates.length,
            ", ids",
            JSON.stringify(pendingClarification.candidates.map((c) => c.id)),
            ")",
          );
        }

        const mapping = ACTION_BY_TOOL[toolName];
        if (!mapping) continue;

        const startedIndex = actions.findLastIndex(
          (a) => a.code === mapping.code && a.phase === "started",
        );
        const startedAction = startedIndex >= 0 ? actions[startedIndex] : null;

        const succeeded = output?.status === "ok";
        if (succeeded) anySuccess = true;
        const params = extractParams(mapping, {}, output);

        const finished: Omit<ChatAction, "id"> = {
          code: mapping.code,
          phase: succeeded ? "done" : "failed",
          params: params ?? startedAction?.params,
        };
        const finishedWithId: ChatAction = {
          id: `${toolName}-done-${actions.length}`,
          ...finished,
        };
        actions.push(finishedWithId);
        enqueue({ type: "action", action: finished });
        continue;
      }
    }

    const finalText = (result.finalOutput ?? "").toString().trim();
    return finalText ? { ok: true, finalText } : { ok: false, mode: "empty" };
  };

  // Shared with `cancel()` so a client disconnect stops provider work and
  // freezes this request's writes; each request owns its own state.
  let closed = false;
  const abortController = new AbortController();
  // Ambiguous candidates (with ids) observed during this turn's tool runs;
  // stashed on the conversation so the agent can resolve the user's next turn
  // (docs/fix.txt). Cleared on every turn (set to null when absent).
  let pendingClarification: PendingDisambiguation = { tool: "", candidates: [] };
  // The exact id the agent resolved to this turn (via an id parameter, or the
  // server's deterministic pick above), so the following confirmation turn can
  // reuse it.
  let resolvedTarget: { tool: string; id: string } | null = serverResolvedTarget;
  // Whether any tool reported a successful (status: ok) completion this turn.
  let anySuccess = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // `settled` guarantees exactly one terminal done/error event.
      let settled = false;
      const actions: ChatAction[] = [];

      const enqueue = (event: ChatStreamEvent | "[DONE]") => {
        if (closed) return;
        controller.enqueue(sseChunk(event));
      };

      /** Confirmed-successful mutation outcomes streamed so far. */
      const recoveryState = (): RecoveryState => ({
        successfulActions: actions.filter((action) => action.phase === "done"),
        mutationAttempted:
          actions.findIndex((action) => action.phase === "started") >= 0 ||
          actions.length > 0,
      });

      /**
       * Persist user + assistant messages to the database.
       * Creates a new conversation on the first turn if none exists.
       * Called once per successful turn completion.
       */
      const persistMessages = async (text: string, finalActions: ChatAction[]) => {
        try {
          // Create a new conversation if this is the first turn.
          if (!activeConversationId) {
            const convResult = await createConversation(parsed.userMessage);
            if (convResult.ok) {
              activeConversationId = convResult.data.id;
            } else {
              console.error("[ai-chat] failed to create conversation:", convResult.reason);
              return; // Non-fatal — the chat still works, it just won't persist.
            }
          }

          // Save the user message (with image URL if attached).
          await saveUserMessage(activeConversationId, parsed.userMessage, parsed.imageUrl);

          // Save the assistant message (with its final actions, excluding "started" phase).
          const persistedActions = finalActions.filter((a) => a.phase !== "started");
          await saveAssistantMessage(activeConversationId, text, persistedActions);

          // Touch the conversation's updated_at for recency ordering.
          await touchConversation(activeConversationId);
        } catch (error) {
          // Persistence failure is non-fatal — the chat still worked for the user.
          console.error("[ai-chat] message persistence failed:", error);
        }
      };

      const settleDone = (text: string) => {
        if (settled || closed) return;
        settled = true;

        const finalActions = actions.filter((action) => action.phase !== "started");

        // Persist messages in the background (non-blocking for the SSE stream).
        void persistMessages(text, finalActions);

        console.log("[ai-chat] settleDone — conversationId:", activeConversationId ?? "null");
        enqueue({
          type: "done",
          text,
          actions: finalActions,
          conversationId: activeConversationId,
        });
      };
      const settleError = (code: ChatErrorCode) => {
        if (settled || closed) return;
        settled = true;
        console.error("[ai-chat] run failed:", code);
        enqueue({ type: "error", code });
      };

      try {
        // Attempt 1 — plus at most ONE clean recovery attempt for provably
        // read-only runs (never for runs where a mutation tool appeared).
        for (let attemptNo = 1; attemptNo <= 2; attemptNo += 1) {
          const mayRetry = attemptNo === 1 && !closed && !abortController.signal.aborted;
          let outcome: Awaited<ReturnType<typeof runOnce>>;
          try {
            outcome = await runOnce(enqueue, actions, abortController.signal);
          } catch (error) {
            const code = classifyRunError(error);
            const decision = decideRunFailure(recoveryState(), code, parsed.language);
            if (decision.kind === "retry" && mayRetry) continue;
            if (decision.kind === "done") {
              settleDone(decision.text);
            } else if (decision.kind === "error") {
              settleError(decision.code);
            } else {
              // Retry budget exhausted on a read-only run.
              settleError(code);
            }
            break;
          }

          if (outcome.ok) {
            settleDone(outcome.finalText);
            break;
          }

          // Stream completed but the final answer was empty/truncated.
          const decision = decideEmptyFinalOutput(recoveryState(), parsed.language);
          if (decision.kind === "retry" && mayRetry) continue;
          if (decision.kind === "done") settleDone(decision.text);
          else settleError("response_incomplete");
          break;
        }
      } finally {
        closed = true;
        // Stash (or clear) disambiguation context for the next turn so the agent
        // can resolve the user's selection to the exact id (docs/fix.txt).
        //
        // IMPORTANT: this persist MUST be awaited BEFORE the stream is closed.
        // The client only sees the stream end after controller.close(), so it
        // may immediately fire the next turn (e.g. "pehla wala") and read this
        // state. If we wrote it after close() (or fire-and-forget with void),
        // the next turn's getConversation read would race ahead of the write and
        // load empty candidates -> the model would invent a fake id that always
        // resolves NOT_FOUND. Awaiting first makes the write durable before the
        // client can proceed.
        if (activeConversationId) {
          let next: PendingDisambiguation | null = null;
          // Prefer an already-resolved single id. Even if the same turn ALSO
          // re-listed candidates (e.g. the model re-searched by name before
          // narrowing to the picked record), the resolved id is the more
          // advanced/authoritative state: the user has already chosen, so the
          // NEXT (confirmation) turn must carry that exact id rather than be
          // handed the candidate list again and forced to re-disambiguate.
          if (resolvedTarget) {
            next = { tool: resolvedTarget.tool, candidates: [], resolvedId: resolvedTarget.id };
            console.log(
              "[disambiguation] turn end -> stash resolvedId",
              JSON.stringify(resolvedTarget),
            );
          } else if (pendingClarification.candidates.length > 0) {
            // Still awaiting the user's pick among listed candidates.
            next = pendingClarification;
            console.log(
              "[disambiguation] turn end -> stash candidate list (count",
              pendingClarification.candidates.length,
              ")",
            );
          }
          // anySuccess => the action completed; clear any pending context.
          await setPendingDisambiguation(activeConversationId, anySuccess ? null : next);
        }
        enqueue("[DONE]");
        try {
          controller.close();
        } catch {
          // Already cancelled by the client — nothing to release.
        }
      }
    },
    cancel() {
      // Client disconnected: stop consuming provider quota immediately and
      // keep this request's state fully isolated from the next one.
      closed = true;
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
