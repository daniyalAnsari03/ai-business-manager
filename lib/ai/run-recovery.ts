import type { Language } from "@/lib/business/types";
import type { ChatAction, ChatActionCode, ChatErrorCode } from "@/lib/ai/chat-protocol";
import { dictionaries, type Dictionary } from "@/lib/i18n/dictionary";

/**
 * Post-run recovery decisions for the AI chat route (server-only logic, no
 * request-context dependencies so it stays unit-testable).
 *
 * A run can end in three imperfect ways even when the underlying business
 * work succeeded:
 *
 * 1. Every provider failed AFTER a mutation tool already committed to the
 *    database (final-answer turn exhausted the whole chain). The tool result
 *    is authoritative: the operation happened. The user must receive an honest
 *    confirmation built from the CONFIRMED backend outcomes — never a quota
 *    error and never a replay of the mutation.
 * 2. The final model turn returned empty visible text (reasoning/length
 *    truncation). If nothing mutated, one clean retry is safe because reads
 *    are side-effect free and no mutation tool was even attempted.
 * 3. Nothing succeeded at all — surface the classified safe error.
 *
 * Decisions here are pure: they inspect only what actually streamed
 * (tool outcomes) plus the classified error code. They never re-execute
 * business actions; "retry" means re-running the agent conversation itself,
 * which the route may only do when zero mutating tools were invoked.
 */

/** What the route observed from the stream before recovery was decided. */
export interface RecoveryState {
  /** Mutation tools whose backend result confirmed success (status ok). */
  readonly successfulActions: ChatAction[];
  /**
   * True when ANY registered mutation tool call started this run (even if its
   * outcome never arrived). Such runs are NEVER retried automatically.
   */
  readonly mutationAttempted: boolean;
}

export type RecoveryDecision =
  | { kind: "done"; text: string }
  | { kind: "error"; code: ChatErrorCode }
  | { kind: "retry" };

const ACTION_LABEL_KEY: Record<ChatActionCode, keyof Dictionary["aiChat"]> = {
  product_created: "actionProductCreated",
  product_updated: "actionProductUpdated",
  stock_updated: "actionStockUpdated",
  product_removed: "actionProductRemoved",
  customer_added: "actionCustomerAdded",
  customer_updated: "actionCustomerUpdated",
  customer_removed: "actionCustomerRemoved",
  order_created: "actionOrderCreated",
  order_status_changed: "actionOrderStatusChanged",
  expense_added: "actionExpenseAdded",
  expense_updated: "actionExpenseUpdated",
  expense_removed: "actionExpenseRemoved",
  business_updated: "actionBusinessUpdated",
};

function interpolate(template: string, params?: Record<string, string>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? params[key] : match,
  );
}

function localizeStatusParam(
  language: Language,
  status: string | undefined,
): Record<string, string> | undefined;

function localizeStatusParam(
  language: Language,
  status: unknown,
): Record<string, string> | undefined {
  if (typeof status !== "string" || !status) return undefined;
  const t = dictionaries[language].aiChat;
  const label =
    status === "completed"
      ? t.statusCompleted
      : status === "cancelled"
        ? t.statusCancelled
        : t.statusPending;
  return { status: String(label) };
}

/**
 * Builds the deterministic confirmation text from CONFIRMED successful
 * mutations, using the same localized labels the UI action pills use. This is
 * never fabricated data: every line corresponds to a tool output whose JSON
 * carried `status:"ok"` from the business service layer.
 */
export function synthesizeConfirmation(
  language: Language,
  successfulActions: ChatAction[],
): string {
  const t = dictionaries[language].aiChat;
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const action of successfulActions) {
    if (action.phase !== "done") continue;
    let params = action.params ?? {};
    if (action.code === "order_status_changed") {
      params = {
        ...params,
        ...(localizeStatusParam(language, params.status) ?? {}),
      };
    }
    const line = interpolate(
      String(t[ACTION_LABEL_KEY[action.code]]),
      params,
    ).trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines.join("\n");
}

/** Provider-level failures where ONE clean re-attempt may legitimately help. */
export function isProviderRecoverableCode(code: ChatErrorCode): boolean {
  return (
    code === "ai_overloaded" || code === "provider_auth" || code === "try_again"
  );
}

/**
 * Decision after the run STREAMED COMPLETELY but produced no usable final
 * text (e.g. reasoning consumed the whole completion budget).
 */
export function decideEmptyFinalOutput(
  state: RecoveryState,
  language: Language,
): RecoveryDecision {
  if (state.successfulActions.length > 0) {
    return {
      kind: "done",
      text: synthesizeConfirmation(language, state.successfulActions),
    };
  }
  // No mutation was even attempted → a single clean retry cannot duplicate
  // any business write.
  if (!state.mutationAttempted) return { kind: "retry" };
  return { kind: "error", code: "response_incomplete" };
}

/**
 * Decision after the run THREW. Provider-level errors must never mask
 * confirmed business outcomes, and provably read-only runs get exactly one
 * clean second attempt before the safe error surfaces.
 */
export function decideRunFailure(
  state: RecoveryState,
  code: ChatErrorCode,
  language: Language,
): RecoveryDecision {
  if (state.successfulActions.length > 0) {
    return {
      kind: "done",
      text: synthesizeConfirmation(language, state.successfulActions),
    };
  }
  if (!state.mutationAttempted && isProviderRecoverableCode(code)) {
    return { kind: "retry" };
  }
  return { kind: "error", code };
}
