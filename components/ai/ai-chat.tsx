"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";

import {
  CheckIcon,
  ClockIcon,
  CopyIcon,
  ImageIcon,
  LoaderIcon,
  MicIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  BrandMark,
  SquareStopIcon,
  XIcon,
} from "@/components/ui/icons";
import { EASE_PREMIUM } from "@/components/motion/presets";
import { useI18n } from "@/components/i18n/language-provider";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type {
  ChatAction,
  ChatActionCode,
  ChatErrorCode,
  ChatMessageDto,
  ChatStreamEvent,
} from "@/lib/ai/chat-protocol";
import { useVoiceTurn, type TurnSubmitResult } from "@/components/ai/use-voice-turn";
import { VoicePanel } from "@/components/ai/voice-panel";
import {
  ChatHistorySidebar,
} from "@/components/ai/chat-history-sidebar";
import { cn } from "@/lib/utils";

/**
 * AI Manager chat — the premium front-end of the AI Business Manager.
 * It never talks to Gemini or any provider directly; it only exchanges the
 * simplified SSE protocol (status / action / done / error) with our own
 * server-side agent route, so no secrets and no tool names ever reach here.
 */

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions: ChatAction[];
  /** Attached image preview URL for user messages. */
  imageUrl?: string;
  /** Assistant message still being produced. */
  pending?: boolean;
  errorCode?: ChatErrorCode | null;
}

type StatusPhase = "thinking" | "checking_data" | "composing" | null;

const ACTION_KEY: Record<ChatActionCode, keyof Dictionary["aiChat"]> = {
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

const ERROR_KEY: Record<ChatErrorCode, keyof Dictionary["aiChat"]> = {
  unauthenticated: "errorUnauthenticated",
  invalid_input: "errorInvalidInput",
  busy: "errorBusy",
  ai_not_configured: "errorAiNotConfigured",
  ai_overloaded: "errorAiOverloaded",
  provider_auth: "errorProviderAuth",
  try_again: "errorTryAgain",
  response_incomplete: "errorResponseIncomplete",
};

const STATUS_KEY: Record<
  Exclude<StatusPhase, null>,
  keyof Dictionary["aiChat"]
> = {
  thinking: "statusThinking",
  checking_data: "statusCheckingData",
  composing: "statusComposing",
};

/* ---------------------------------------------------------------------------
 * Inline image rendering — detect image URLs in assistant text and render
 * them as actual <img> elements instead of plain text links.
 * ------------------------------------------------------------------------ */

const IMAGE_URL_RE =
  /(?:https?:\/\/[^\s"'<>)]+\/storage\/v1\/object\/public\/product-images\/[^\s"'<>)]+|(?:https?:\/\/[^\s"'<>)]+\.(?:png|jpe?g|webp|gif))(?:\?[^\s"'<>)]*)?)/gi;

type TextSegment = { kind: "text"; value: string } | { kind: "image"; url: string };

function parseContentSegments(content: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  for (const match of content.matchAll(IMAGE_URL_RE)) {
    const start = match.index!;
    if (start > lastIndex) {
      segments.push({ kind: "text", value: content.slice(lastIndex, start) });
    }
    segments.push({ kind: "image", url: match[0] });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ kind: "text", value: content.slice(lastIndex) });
  }
  return segments;
}

function InlineImage({ src }: { src: string }) {
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-emerald-500/25">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Product image"
        className="max-h-48 w-auto rounded-xl object-cover"
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Mutation safety helpers — determine whether edit/regenerate is safe.
 * ------------------------------------------------------------------------ */

/** Does this assistant message contain any successfully completed mutation? */
function hasSuccessfulMutation(message: UiMessage): boolean {
  return message.actions.some((a) => a.phase === "done");
}

/** For a user message at index i, check if any assistant message AFTER it had a successful mutation. */
function hasMutationAfterMessage(
  messages: UiMessage[],
  messageIndex: number,
): boolean {
  for (let i = messageIndex + 1; i < messages.length; i++) {
    if (messages[i].role === "assistant" && hasSuccessfulMutation(messages[i])) {
      return true;
    }
  }
  return false;
}

/**
 * Typewriter pacing — decouples "when text arrives from the network" from
 * "when text is shown to the user".  Incoming deltas are queued, then drained
 * onto the screen at a controlled, steady rate independent of network timing.
 * Adjust these constants to tune the reveal speed.
 */
const TYPEWRITER_CHARS_PER_TICK = 3;
const TYPEWRITER_TICK_MS = 20;

function interpolate(
  template: string,
  params?: Record<string, string>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? params[key] : match,
  );
}

function actionLabel(
  t: Dictionary,
  action: Pick<ChatAction, "code" | "phase" | "params">,
): string {
  if (action.phase === "started") return t.aiChat.actionStarted;
  if (action.phase === "failed") return t.aiChat.actionFailed;

  let params = action.params ?? {};
  if (action.code === "order_status_changed" && params.status) {
    const statusKey =
      params.status === "completed"
        ? "statusCompleted"
        : params.status === "cancelled"
          ? "statusCancelled"
          : "statusPending";
    params = { ...params, status: String(t.aiChat[statusKey]) };
  }
  return interpolate(String(t.aiChat[ACTION_KEY[action.code]]), params);
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

export function AiChat() {
  const { t, language } = useI18n();
  const reducedMotion = useReducedMotion();

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusPhase, setStatusPhase] = useState<StatusPhase>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<{
    file: File;
    preview: string;
  } | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImageRef = useRef<{ file: File; preview: string } | null>(null);
  /** Caches the upload URL after first successful upload so subsequent turns
   *  reuse it instead of re-uploading the same file. */
  const consumedImageUrlRef = useRef<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSentRef = useRef<string | null>(null);

  // Keep the ref in sync with pendingImage state.
  useEffect(() => {
    pendingImageRef.current = pendingImage;
  }, [pendingImage]);

  /* Typewriter pacing state — a single ref tracks the current drain target,
     the character queue, the authoritative final text, and the interval. */
  const twRef = useRef({
    queue: "",
    target: null as string | null,
    finalText: null as string | null,
    timer: null as ReturnType<typeof setInterval> | null,
  });

  /* Keep the newest message in view while streaming — but only when the
     user hasn't manually scrolled up to read earlier history. */
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const distFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distFromBottom < 150) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, [messages, statusPhase]);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, []);

  const patchAssistant = useCallback(
    (id: string, patch: (message: UiMessage) => UiMessage) => {
      setMessages((prev) =>
        prev.map((message) => (message.id === id ? patch(message) : message)),
      );
    },
    [],
  );

  /** Stops the typewriter drain loop and clears the queue. */
  const clearTypewriter = useCallback(() => {
    const tw = twRef.current;
    if (tw.timer) { clearInterval(tw.timer); tw.timer = null; }
    tw.queue = "";
    tw.target = null;
    tw.finalText = null;
  }, []);

  /**
   * Drain loop — pops a small number of characters off the queue and appends
   * them to the rendered message content via patchAssistant(). Runs on a fixed
   * interval until the queue is empty.
   */
  const drainTypewriter = useCallback(() => {
    const tw = twRef.current;
    if (!tw.target || tw.queue.length === 0) {
      if (tw.timer) { clearInterval(tw.timer); tw.timer = null; }
      return;
    }
    const take = tw.queue.slice(0, TYPEWRITER_CHARS_PER_TICK);
    tw.queue = tw.queue.slice(TYPEWRITER_CHARS_PER_TICK);
    if (tw.queue.length === 0 && tw.timer) { clearInterval(tw.timer); tw.timer = null; }
    patchAssistant(tw.target, (msg) => ({ ...msg, content: msg.content + take }));
  }, [patchAssistant]);

  /* Clean up the typewriter interval on unmount. */
  useEffect(() => {
    return () => { clearTypewriter(); };
  }, [clearTypewriter]);

  /**
   * Sends one turn through the shared agent pipeline (typed OR spoken input).
   * Resolves with the final reply text so the voice layer can speak it.
   */
  const send = useCallback(
    async (rawText: string): Promise<TurnSubmitResult> => {
      const text = rawText.trim();
      if (!text || busy || text.length > 2000) {
        return { ok: false, errorCode: "busy" };
      }

      lastSentRef.current = text;
      const assistantId = nextId("assistant");

      /* Stop any previous typewriter drain before starting a new turn. */
      clearTypewriter();

      /* Upload pending image if one is attached — reuse URL if already uploaded.
       * Uses consumedImageUrlRef as the primary source so the image survives
       * across clarification turns even if pendingImage state is cleared. */
      let imageUrl: string | undefined;
      const imagePreviewUrl =
        pendingImageRef.current?.preview ?? consumedImageUrlRef.current ?? undefined;

      if (consumedImageUrlRef.current) {
        imageUrl = consumedImageUrlRef.current;
      } else if (pendingImageRef.current) {
        const currentImage = pendingImageRef.current;
        setImageUploading(true);
        try {
          const formData = new FormData();
          formData.append("file", currentImage.file);
          const uploadResponse = await fetch("/api/ai/upload", {
            method: "POST",
            body: formData,
          });
          if (uploadResponse.ok) {
            const uploadData = (await uploadResponse.json()) as { url?: string };
            if (uploadData.url) {
              imageUrl = uploadData.url;
              consumedImageUrlRef.current = uploadData.url;
            }
          }
        } catch {
          // Image upload failed — proceed without it.
        } finally {
          setImageUploading(false);
        }
      }

      /* BUG C FIX: After upload, prefer the permanent storage URL for the
       * message bubble (not the ephemeral blob: preview). This ensures the
       * image survives page reloads and conversation history navigation. */
      const bubbleImageUrl = imageUrl ?? imagePreviewUrl;

      const history: ChatMessageDto[] = messages
        .filter((m) => !m.pending && !m.errorCode)
        .slice(-30)
        .map((m) => ({ role: m.role, content: m.content }));

      console.log("[ai-chat:send] pendingImageRef:", pendingImageRef.current ? "SET" : "null");
      console.log("[ai-chat:send] consumedImageUrlRef:", consumedImageUrlRef.current ?? "null");
      console.log("[ai-chat:send] imageUrl for request:", imageUrl ?? "undefined");
      console.log("[ai-chat:send] imagePreviewUrl:", imagePreviewUrl ?? "undefined");
      console.log("[ai-chat:send] conversationId:", activeConversationId ?? "null");

      setMessages((prev) => [
        ...prev,
        {
          id: nextId("user"),
          role: "user",
          content: text,
          actions: [],
          imageUrl: bubbleImageUrl,
        },
        { id: assistantId, role: "assistant", content: "", actions: [], pending: true },
      ]);
      setDraft("");
      setBusy(true);
      setStatusPhase("thinking");
      requestAnimationFrame(autoGrow);

      const controller = new AbortController();
      abortRef.current = controller;

      let failureCode: ChatErrorCode | null = null;
      let finalReply: string | null = null;
      let settledAssistant = false;

      const finalizeError = (errorCode: ChatErrorCode) => {
        clearTypewriter();
        failureCode = errorCode;
        settledAssistant = true;
        setStatusPhase(null);
        patchAssistant(assistantId, (message) => ({
          ...message,
          pending: false,
          errorCode,
        }));
      };

      try {
        const requestBody = {
          history,
          message: text,
          language,
          conversationId: activeConversationId,
          ...(imageUrl ? { imageUrl } : {}),
        };
        console.log("[ai-chat:send] request body:", JSON.stringify({
          message: text.slice(0, 60),
          conversationId: requestBody.conversationId ?? "null",
          imageUrl: "imageUrl" in requestBody ? requestBody.imageUrl : "(absent)",
          historyLength: history.length,
        }));

        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          let code: ChatErrorCode = "try_again";
          try {
            const data = (await response.json()) as {
              error?: { code?: ChatErrorCode };
            };
            if (data.error?.code) code = data.error.code;
          } catch {
            // Non-JSON failure body — keep the generic code.
          }
          finalizeError(code);
          return { ok: false, errorCode: code };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handleEvent = (event: ChatStreamEvent) => {
          switch (event.type) {
            case "status":
              setStatusPhase(event.phase);
              break;
            case "action": {
              const incoming: ChatAction = { id: nextId("action"), ...event.action };
              patchAssistant(assistantId, (message) => {
                if (incoming.phase === "started") {
                  return { ...message, actions: [...message.actions, incoming] };
                }
                // Replace the matching started pill with its final state.
                const actions = [...message.actions];
                for (let i = actions.length - 1; i >= 0; i -= 1) {
                  if (actions[i].phase === "started") {
                    actions[i] = incoming;
                    break;
                  }
                }
                return { ...message, actions };
              });

              /* Image consumption: if a product was successfully created or
               * updated, the pending image has been consumed — clear it.
               * BUG A FIX: Always clear consumedImageUrlRef regardless of
               * pendingImageRef state to prevent stale image reuse. */
              if (
                incoming.phase === "done" &&
                (incoming.code === "product_created" ||
                  incoming.code === "product_updated")
              ) {
                const img = pendingImageRef.current;
                if (img) {
                  URL.revokeObjectURL(img.preview);
                }
                setPendingImage(null);
                consumedImageUrlRef.current = null;
              }
              break;
            }
            case "text_delta": {
              /* Push incoming characters into the typewriter queue instead of
                 rendering them instantly — the drain loop reveals them at a
                 steady, comfortable reading pace. */
              twRef.current.queue += event.delta ?? "";
              twRef.current.target = assistantId;
              if (!twRef.current.timer) {
                twRef.current.timer = setInterval(drainTypewriter, TYPEWRITER_TICK_MS);
              }
              break;
            }
            case "done": {
              finalReply = event.text;
              settledAssistant = true;
              twRef.current.finalText = event.text;

              // Track the conversation ID returned by the server.
              if (event.conversationId) {
                setActiveConversationId(event.conversationId);
              }

              /* Reconcile: top up the queue to reach the authoritative final
                 text so the reveal finishes smoothly rather than jump-cutting.
                 On mismatch, hard-set the content (no animation). */
              let hardSet = false;
              patchAssistant(assistantId, (message) => {
                const authoritative = event.text;
                const displayed = message.content;
                if (authoritative.startsWith(displayed)) {
                  twRef.current.queue = authoritative.slice(displayed.length);
                  if (twRef.current.queue.length > 0 && !twRef.current.timer) {
                    twRef.current.timer = setInterval(drainTypewriter, TYPEWRITER_TICK_MS);
                  }
                  return {
                    ...message,
                    actions: event.actions.length > 0 ? event.actions : message.actions,
                    pending: false,
                  };
                }
                hardSet = true;
                twRef.current.queue = "";
                return {
                  ...message,
                  content: authoritative,
                  actions: event.actions.length > 0 ? event.actions : message.actions,
                  pending: false,
                };
              });
              if (hardSet && twRef.current.timer) {
                clearInterval(twRef.current.timer);
                twRef.current.timer = null;
              }
              break;
            }
            case "error":
              finalizeError(event.code);
              break;
          }
        };

        // Parse the SSE wire format: `data: <json>\n\n` frames.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let frameEnd = buffer.indexOf("\n\n");
          while (frameEnd >= 0) {
            const frame = buffer.slice(0, frameEnd).trim();
            buffer = buffer.slice(frameEnd + 2);
            frameEnd = buffer.indexOf("\n\n");

            if (!frame.startsWith("data:")) continue;
            const payload = frame.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              handleEvent(JSON.parse(payload) as ChatStreamEvent);
            } catch {
              // Ignore malformed frames instead of failing the whole turn.
            }
          }
        }

        // Stream ended without an explicit done/error (e.g. hard abort).
        if (!settledAssistant) {
          patchAssistant(assistantId, (message) => ({
            ...message,
            pending: false,
            errorCode: message.content ? null : "try_again",
          }));
          failureCode = "try_again";
        }
      } catch {
        clearTypewriter();
        if (controller.signal.aborted) {
          // User pressed stop — keep whatever was produced so far.
          patchAssistant(assistantId, (message) => ({
            ...message,
            pending: false,
            errorCode: message.content ? null : "try_again",
          }));
          if (!settledAssistant) failureCode = "try_again";
        } else {
          finalizeError("try_again");
        }
      } finally {
        setBusy(false);
        setStatusPhase(null);
        abortRef.current = null;
      }

      if (failureCode) return { ok: false, errorCode: failureCode };
      return { ok: true, text: finalReply ?? "" };
    },
    [autoGrow, busy, clearTypewriter, drainTypewriter, language, messages, patchAssistant, activeConversationId],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const startNewChat = useCallback(() => {
    clearTypewriter();
    setMessages([]);
    setActiveConversationId(null);
    setDraft("");
    setStatusPhase(null);
    setBusy(false);
    abortRef.current?.abort();
    // Clear any pending image when starting a new conversation.
    const img = pendingImageRef.current;
    if (img) {
      URL.revokeObjectURL(img.preview);
      setPendingImage(null);
    }
    consumedImageUrlRef.current = null;
  }, [clearTypewriter]);

  const loadConversation = useCallback(
    async (id: string) => {
      if (busy) return;
      try {
        const response = await fetch(`/api/ai/conversations/${id}`);
        if (!response.ok) return;
        const data = (await response.json()) as {
          conversation: { id: string; title: string };
          messages: Array<{
            id: string;
            role: "user" | "assistant";
            content: string;
            actions: ChatAction[];
            imageUrl?: string | null;
          }>;
        };
        clearTypewriter();
        setMessages(
          data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            actions: m.actions,
            imageUrl: m.imageUrl ?? undefined,
          })),
        );
        setActiveConversationId(data.conversation.id);
        setDraft("");
        setStatusPhase(null);
        // Clear pending image when loading a different conversation.
        const img = pendingImageRef.current;
        if (img) {
          URL.revokeObjectURL(img.preview);
          setPendingImage(null);
        }
        consumedImageUrlRef.current = null;
      } catch {
        // Non-fatal — conversation list will still work.
      }
    },
    [busy, clearTypewriter],
  );

  /** Start editing a user message. */
  const startEdit = useCallback(
    (message: UiMessage) => {
      setEditingMessageId(message.id);
      setEditingDraft(message.content);
    },
    [],
  );

  /** Cancel editing. */
  const cancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingDraft("");
  }, []);

  /** Confirm edit — truncate everything after the edited message and resend. */
  const confirmEdit = useCallback(
    async (messageIndex: number) => {
      const editedMessage = messages[messageIndex];
      if (!editedMessage || editedMessage.role !== "user") return;

      const newText = editingDraft.trim();
      if (!newText || newText === editedMessage.content) {
        cancelEdit();
        return;
      }

      // If we have a conversation, truncate messages after this one on the server.
      if (activeConversationId) {
        try {
          await fetch(`/api/ai/conversations/${activeConversationId}/messages`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ afterMessageId: editedMessage.id }),
          });
        } catch {
          // Non-fatal — we'll still truncate in the UI.
        }
      }

      // Truncate messages in UI state — keep everything up to (not including) the edited message.
      clearTypewriter();
      setMessages((prev) => prev.slice(0, messageIndex));
      setEditingMessageId(null);
      setEditingDraft("");
      setActiveConversationId(null); // Force a new conversation since we truncated.

      // Resend as a new message.
      await send(newText);
    },
    [messages, editingDraft, activeConversationId, cancelEdit, clearTypewriter, send],
  );

  /** Regenerate an assistant message — resend the preceding user message. */
  const regenerate = useCallback(
    async (messageIndex: number) => {
      const assistantMsg = messages[messageIndex];
      if (!assistantMsg || assistantMsg.role !== "assistant") return;
      if (hasSuccessfulMutation(assistantMsg)) return; // Safety: never regenerate after mutations.

      // Find the preceding user message.
      const userMsgIndex = messageIndex - 1;
      if (userMsgIndex < 0) return;
      const userMsg = messages[userMsgIndex];
      if (!userMsg || userMsg.role !== "user") return;

      // Truncate from this assistant message onward.
      if (activeConversationId) {
        try {
          await fetch(`/api/ai/conversations/${activeConversationId}/messages`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ afterMessageId: userMsg.id }),
          });
        } catch {
          // Non-fatal.
        }
      }

      clearTypewriter();
      setMessages((prev) => prev.slice(0, userMsgIndex));
      setActiveConversationId(null); // New conversation since we truncated.

      // Resend the user's original message.
      await send(userMsg.content);
    },
    [messages, activeConversationId, clearTypewriter, send],
  );

  /* Voice shares the exact same pipeline: recognized speech is submitted as
     ordinary text through `send`, so history, actions, confirmations and the
     Gemini failover router behave identically to typed chat. */
  const submitTurn = useCallback(
    (text: string) => send(text),
    [send],
  );
  const voice = useVoiceTurn({ language, submit: submitTurn });

  const handleMicPress = () => {
    if (voice.status === "listening") voice.stopListening();
    else voice.startListening();
  };
  const micActive = voice.status === "listening";

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  };

  const empty = messages.length === 0;
  const suggestions = [
    t.aiChat.suggestionSales,
    t.aiChat.suggestionLowStock,
    t.aiChat.suggestionAddProduct,
    t.aiChat.suggestionExpenses,
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="card-surface relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div aria-hidden className="ambient-glow -left-24 -top-28 size-[320px]" />

        {/* Conversation scroll area */}
        <div
          ref={scrollRef}
          className="relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 pt-6 sm:px-6 chat-scrollbar"
          aria-live="polite"
        >
          {empty ? (
            <div className="mx-auto flex w-full max-w-lg flex-col items-center justify-center px-2 py-8 text-center my-auto">
              <BrandMark className="size-14 rounded-2xl shadow-glow-btn" />
              <h2 className="mt-5 font-display text-xl font-light sm:text-2xl">
                {t.aiChat.greetingTitle}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {t.aiChat.greetingBody}
              </p>
              <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="min-h-11 rounded-full border border-line bg-surface-raised px-4 py-2 text-left text-sm text-muted shadow-card transition-all duration-300 hover:border-emerald-500/40 hover:text-accent active:translate-y-px"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col justify-start">
              <ul className="w-full space-y-5 pb-6">
                {messages.map((message, messageIndex) => (
                  <motion.li
                    key={message.id}
                    initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: EASE_PREMIUM }}
                    className={cn(
                      "flex gap-3",
                      message.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    {message.role === "assistant" ? (
                      <BrandMark
                        aria-hidden
                        className="mt-1 size-8 shrink-0 rounded-xl shadow-glow-btn"
                      />
                    ) : null}

                    <div className={cn(
                      "min-w-0 space-y-2",
                      message.role === "user" ? "max-w-[80%] sm:max-w-[70%]" : "max-w-full",
                    )}>
                      {message.role === "user" ? (
                        editingMessageId === message.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={editingDraft}
                              onChange={(e) => setEditingDraft(e.target.value.slice(0, 2000))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  void confirmEdit(messageIndex);
                                }
                                if (e.key === "Escape") cancelEdit();
                              }}
                              rows={2}
                              autoFocus
                              className="w-full resize-none rounded-2xl border border-emerald-500/50 bg-emerald-500/[0.12] px-4 py-2.5 text-sm leading-relaxed outline-none"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => void confirmEdit(messageIndex)}
                                disabled={!editingDraft.trim() || busy}
                                className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-medium text-emerald-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
                              >
                                {t.aiChat.confirmEdit}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:text-foreground"
                              >
                                {t.aiChat.cancelEdit}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-end gap-1.5">
                            {message.imageUrl && (
                              <div className="mb-0.5 overflow-hidden rounded-xl border border-emerald-500/25">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={message.imageUrl}
                                  alt="Attached image"
                                  className="max-h-48 w-auto rounded-xl object-cover"
                                />
                              </div>
                            )}
                            <p className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-emerald-500/25 bg-emerald-500/[0.12] px-4 py-2.5 text-sm leading-relaxed">
                              {message.content}
                            </p>
                            {!busy && !hasMutationAfterMessage(messages, messageIndex) && (
                              <button
                                type="button"
                                onClick={() => startEdit(message)}
                                aria-label={t.aiChat.editMessage}
                                title={t.aiChat.editMessage}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-faint transition-all duration-200 hover:bg-surface-raised hover:text-accent focus-visible:opacity-100 min-touch-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                              >
                                <PencilIcon className="size-3.5" />
                              </button>
                            )}
                          </div>
                        )
                      ) : (
                        <>
                          {(message.content || !message.pending) && (
                            <div className="group relative">
                              {message.imageUrl && (
                                <div className="mb-2 overflow-hidden rounded-xl border border-emerald-500/25">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={message.imageUrl}
                                    alt="Product image"
                                    className="max-h-48 w-auto rounded-xl object-cover"
                                  />
                                </div>
                              )}
                              <div className="whitespace-pre-wrap break-words py-1 text-[0.9375rem] leading-[1.75] tracking-[-0.01em]">
                                {(() => {
                                  const segments = parseContentSegments(message.content);
                                  if (segments.length <= 1) {
                                    return message.content;
                                  }
                                  return segments.map((seg, i) =>
                                    seg.kind === "image" ? (
                                      <InlineImage key={i} src={seg.url} />
                                    ) : (
                                      <span key={i}>{seg.value}</span>
                                    ),
                                  );
                                })()}
                              </div>
                              {message.content && !message.pending && (
                                <div className="-ml-2 mt-0.5 flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void navigator.clipboard.writeText(message.content);
                                      setCopiedMessageId(message.id);
                                      setTimeout(() => setCopiedMessageId(null), 1500);
                                    }}
                                    aria-label={copiedMessageId === message.id ? t.aiChat.copiedMessage : t.aiChat.copyMessage}
                                    title={copiedMessageId === message.id ? t.aiChat.copiedMessage : t.aiChat.copyMessage}
                                    className={cn(
                                      "inline-flex h-9 w-9 items-center justify-center rounded-lg text-faint transition-all duration-200 hover:bg-surface-raised hover:text-foreground min-touch-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
                                      copiedMessageId === message.id && "text-accent",
                                    )}
                                  >
                                    {copiedMessageId === message.id ? (
                                      <CheckIcon className="size-[1.1rem]" />
                                    ) : (
                                      <CopyIcon className="size-[1.1rem]" />
                                    )}
                                  </button>
                                  {!busy && !hasSuccessfulMutation(message) && (
                                    <button
                                      type="button"
                                      onClick={() => void regenerate(messageIndex)}
                                      aria-label={t.aiChat.regenerate}
                                      title={t.aiChat.regenerate}
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-faint transition-all duration-200 hover:bg-surface-raised hover:text-foreground min-touch-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                                    >
                                      <RefreshCwIcon className="size-3.5" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {message.actions.length > 0 && (
                            <ul className="flex flex-wrap gap-1.5">
                              {message.actions.map((action) => (
                                <li
                                  key={action.id}
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
                                    action.phase === "failed"
                                      ? "border-red-500/30 bg-red-500/[0.08] text-red-600 dark:text-red-400"
                                      : action.phase === "done"
                                        ? "border-emerald-500/30 bg-emerald-500/[0.08] text-accent"
                                        : "border-line bg-surface text-muted",
                                  )}
                                >
                                  {action.phase === "started" ? (
                                    <LoaderIcon className="size-3 animate-spin" />
                                  ) : action.phase === "done" ? (
                                    <CheckIcon className="size-3" />
                                  ) : null}
                                  {actionLabel(t, action)}
                                </li>
                              ))}
                            </ul>
                          )}

                          {message.pending && !message.content && (
                            <p className="inline-flex items-center gap-2 py-1 text-xs text-muted">
                              <span className="flex items-center gap-1" aria-hidden>
                                <Dot delay="0ms" />
                                <Dot delay="160ms" />
                                <Dot delay="320ms" />
                              </span>
                              {statusPhase ? t.aiChat[STATUS_KEY[statusPhase]] : t.aiChat.statusThinking}
                            </p>
                          )}

                          {message.errorCode && (
                            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-xs text-red-600 dark:text-red-400">
                              <span>{t.aiChat[ERROR_KEY[message.errorCode]]}</span>
                              {lastSentRef.current && (
                                <button
                                  type="button"
                                  onClick={() => void send(lastSentRef.current as string)}
                                  disabled={busy}
                                  className="min-h-8 rounded-full border border-red-500/30 px-3 font-medium transition-colors hover:bg-red-500/10 disabled:opacity-50"
                                >
                                  {t.aiChat.retry}
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </motion.li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Voice interaction — constrained so animated height changes
            don't push the composer around. */}
        <div className="shrink-0 overflow-hidden">
          <VoicePanel voice={voice} t={t} />
        </div>

        <div aria-hidden className="hairline" />

        {/* Pending image preview */}
        {pendingImage && (
          <div className="flex items-center gap-3 bg-surface px-3 py-2 sm:px-4">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingImage.preview}
                alt="Attached image"
                className="size-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-muted">{pendingImage.file.name}</p>
              <p className="text-[11px] text-faint">
                {(pendingImage.file.size / 1024).toFixed(0)} KB
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(pendingImage.preview);
                setPendingImage(null);
                consumedImageUrlRef.current = null;
              }}
              aria-label={t.aiChat.removeImage}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-red-500/10 hover:text-red-500"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        )}

        {/* Composer — pinned at the bottom by the card's flex column layout
            (scroll area takes flex-1, composer is a non-growing flex child). */}
        <form
          className="flex shrink-0 items-end gap-2 bg-surface p-3 sm:p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) {
                alert(t.aiChat.imageTooLarge);
                return;
              }
              if (
                !["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(
                  file.type,
                )
              ) {
                alert(t.aiChat.imageBadType);
                return;
              }
              if (pendingImage) URL.revokeObjectURL(pendingImage.preview);
              setPendingImage({ file, preview: URL.createObjectURL(file) });
              consumedImageUrlRef.current = null;
              event.target.value = "";
            }}
          />

          {/* + button — first on mobile, hidden on desktop */}
          <MoreActionsMenu
            open={moreOpen}
            onOpenChange={setMoreOpen}
            onOpenHistory={() => setHistoryOpen(true)}
            onUploadImage={() => fileInputRef.current?.click()}
            busy={busy}
            imageUploading={imageUploading}
            moreLabel={t.aiChat.moreOptions}
            historyLabel={t.aiChat.historyTitle}
            attachImageLabel={t.aiChat.attachImage}
          />

          {/* History button — desktop only, second position */}
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label={t.aiChat.openHistory}
            title={t.aiChat.openHistory}
            className="hidden size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card transition-colors hover:border-emerald-500/40 hover:text-accent min-touch-target lg:inline-flex"
          >
            <ClockIcon className="size-4" />
          </button>

          {/* Image attach button — desktop only, third position */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || imageUploading}
            aria-label={t.aiChat.attachImage}
            title={t.aiChat.attachImage}
            className={cn(
              "hidden size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card transition-colors hover:border-emerald-500/40 hover:text-accent min-touch-target lg:inline-flex",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {imageUploading ? (
              <LoaderIcon className="size-4 animate-spin" />
            ) : (
              <ImageIcon className="size-4" />
            )}
          </button>

          {/* Input — flexible middle section */}
          <label htmlFor="ai-chat-input" className="sr-only">
            {t.aiChat.inputAriaLabel}
          </label>
          <textarea
            id="ai-chat-input"
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
            onKeyDown={onKeyDown}
            placeholder={t.aiChat.inputPlaceholder}
            rows={1}
            autoComplete="off"
            className="max-h-33 min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-emerald-500/50"
          />

          {/* Voice button */}
          <button
            type="button"
            onClick={handleMicPress}
            disabled={voice.status === "processing" || busy}
            aria-label={
              micActive ? t.aiVoice.tapToFinish : t.aiVoice.talkToAi
            }
            title={micActive ? t.aiVoice.listening : t.aiVoice.talkToAi}
            aria-pressed={micActive}
            className={cn(
              "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition-all duration-300 min-touch-target",
              micActive
                ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-emerald-950 shadow-glow-btn ring-white/20 hover:from-emerald-300 hover:to-emerald-500 active:translate-y-px"
                : "border border-line bg-surface text-muted shadow-card ring-transparent hover:border-emerald-500/40 hover:text-accent disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {micActive && !reducedMotion && (
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full border-2 border-emerald-400/50"
                animate={{ scale: [1, 1.28], opacity: [0.7, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
              />
            )}
            {micActive ? (
              <SquareStopIcon className="relative size-4" />
            ) : (
              <MicIcon className="relative size-4" />
            )}
          </button>

          {/* Stop / Send button — last on all devices */}
          {busy ? (
            <button
              type="button"
              onClick={stop}
              aria-label={t.aiChat.stop}
              title={t.aiChat.stop}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card transition-colors hover:border-emerald-500/40 hover:text-accent min-touch-target"
            >
              <SquareStopIcon className="size-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label={t.aiChat.send}
              title={t.aiChat.send}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 text-emerald-950 shadow-glow-btn ring-1 ring-inset ring-white/20 transition-all duration-300 hover:from-emerald-300 hover:to-emerald-500 hover:shadow-glow-btn-hover active:translate-y-px disabled:pointer-events-none disabled:opacity-50 min-touch-target"
            >
              <SendIcon className="size-4" />
            </button>
          )}
        </form>

        <p className="max-w-none shrink-0 px-4 pb-3 pt-0.5 text-center text-[11px] leading-snug text-faint sm:px-6 sm:text-xs">{t.aiChat.disclaimer}</p>
      </div>

      <ChatHistorySidebar
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        activeConversationId={activeConversationId}
        onSelectConversation={loadConversation}
        onNewChat={startNewChat}
      />
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="size-1 animate-pulse rounded-full bg-current"
      style={{ animationDelay: delay }}
    />
  );
}

/**
 * Mobile-only "+" menu — hosts Chat History and Image Upload.
 *
 * The popover is rendered through a portal with `position: fixed` and its
 * position is measured against the real viewport, so it can NEVER open
 * outside the screen (or be clipped by the chat card's `overflow-hidden`).
 * It opens upward by default (mirroring the button's bottom-right corner)
 * and flips downward only when there is no room above.
 */
const MORE_MENU_WIDTH = 208;

function MoreActionsMenu({
  open,
  onOpenChange,
  onOpenHistory,
  onUploadImage,
  busy,
  imageUploading,
  moreLabel,
  historyLabel,
  attachImageLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenHistory: () => void;
  onUploadImage: () => void;
  busy: boolean;
  imageUploading: boolean;
  moreLabel: string;
  historyLabel: string;
  attachImageLabel: string;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    openUp: boolean;
  } | null>(null);

  /* Measure the toggle button + menu and clamp to the viewport. Runs as a
     layout effect so the menu never paints at a wrong position. */
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu || pos) return;

    const buttonRect = button.getBoundingClientRect();
    const menuHeight = menu.offsetHeight || 128;
    const menuWidth = menu.offsetWidth || MORE_MENU_WIDTH;
    const gap = 8;
    const margin = 12;
    const spaceAbove = buttonRect.top;
    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const openUp = spaceAbove >= menuHeight + gap || spaceBelow < menuHeight + gap;

    const top = openUp
      ? Math.max(margin, buttonRect.top - menuHeight - gap)
      : Math.min(buttonRect.bottom + gap, window.innerHeight - menuHeight - margin);
    const left = Math.max(
      margin,
      Math.min(buttonRect.right - menuWidth, window.innerWidth - menuWidth - margin),
    );
    setPos({ top, left, openUp });
  }, [open, pos]);

  /* Re-anchor if the viewport changes while the menu is open. */
  useEffect(() => {
    if (!open) return;
    const onResize = () => setPos(null);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  /* Close on outside tap / Escape. */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <>
      <div className="shrink-0 lg:hidden">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-label={moreLabel}
          title={moreLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card transition-colors hover:border-emerald-500/40 hover:text-accent min-touch-target"
        >
          <PlusIcon className="size-4" />
        </button>
      </div>

      {open
        ? createPortal(
            <motion.div
              ref={menuRef}
              role="menu"
              aria-label={moreLabel}
              initial={reducedMotion ? false : { opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18, ease: EASE_PREMIUM }}
              className="fixed z-50 w-52 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-card-hover"
              style={{
                top: pos ? pos.top : 0,
                left: pos ? pos.left : 0,
                visibility: pos ? "visible" : "hidden",
                transformOrigin: pos?.openUp ? "bottom right" : "top right",
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onOpenChange(false);
                  onOpenHistory();
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-raised hover:text-accent min-touch-target-sm"
              >
                <ClockIcon className="size-4 shrink-0 text-muted" />
                {historyLabel}
              </button>
              <div className="mx-3 h-px bg-line" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onOpenChange(false);
                  onUploadImage();
                }}
                disabled={busy || imageUploading}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-raised hover:text-accent disabled:opacity-50 min-touch-target-sm"
              >
                <ImageIcon className="size-4 shrink-0 text-muted" />
                {attachImageLabel}
              </button>
            </motion.div>,
            document.body,
          )
        : null}
    </>
  );
}
