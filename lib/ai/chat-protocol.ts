/**
 * Wire protocol shared by the AI chat API route and the chat UI.
 * Pure types/constants only — no secrets, no server imports.
 */

export type ChatRole = "user" | "assistant";

export interface ChatMessageDto {
  role: ChatRole;
  content: string;
}

/** Stable codes the UI maps to localized action pills (never raw tool names). */
export type ChatActionCode =
  | "product_created"
  | "product_updated"
  | "stock_updated"
  | "product_removed"
  | "customer_added"
  | "customer_updated"
  | "customer_removed"
  | "order_created"
  | "order_status_changed"
  | "expense_added"
  | "expense_updated"
  | "expense_removed"
  | "business_updated";

export interface ChatAction {
  /** Unique per emitted event (for React keys). */
  id: string;
  code: ChatActionCode;
  phase: "started" | "done" | "failed";
  params?: Record<string, string>;
}

export type ChatErrorCode =
  | "unauthenticated"
  | "invalid_input"
  | "busy"
  | "ai_not_configured"
  | "ai_overloaded"
  | "provider_auth"
  | "try_again"
  | "response_incomplete";

/** Server-sent-events payload union consumed by the chat UI. */
export type ChatStreamEvent =
  | { type: "status"; phase: "thinking" | "checking_data" | "composing" }
  | { type: "action"; action: Omit<ChatAction, "id"> }
  | { type: "text_delta"; delta: string }
  | { type: "done"; text: string; actions: ChatAction[]; conversationId?: string }
  | { type: "error"; code: ChatErrorCode };
