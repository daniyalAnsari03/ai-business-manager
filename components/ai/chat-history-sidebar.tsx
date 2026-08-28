"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  ArrowLeftIcon,
  MessageCircleIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/components/i18n/language-provider";
import { cn } from "@/lib/utils";

/**
 * Chat history sidebar — conversation list for the AI Manager.
 *
 * On desktop (>= lg), it overlays the nav sidebar area (fixed left, w-64,
 * z-50) so no layout reflow of the chat area occurs.
 * On mobile (< lg), it opens as a slide-over drawer from the left.
 *
 * Selecting a conversation loads it into the chat. Clicking "New Chat"
 * starts a fresh conversation. The sidebar auto-closes on selection.
 */

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface ChatHistorySidebarProps {
  open: boolean;
  onClose: () => void;
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
}

function timeAgo(dateString: string, locale: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return locale === "ur" ? "Abhi" : "Just now";
  if (diffMin < 60) {
    return locale === "ur" ? `${diffMin} min pehle` : `${diffMin}m ago`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return locale === "ur" ? `${diffHr} ghante pehle` : `${diffHr}h ago`;
  }
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) {
    return locale === "ur" ? `${diffDay} din pehle` : `${diffDay}d ago`;
  }
  const date = new Date(dateString);
  return date.toLocaleDateString(locale === "ur" ? "en-PK" : "en-US", {
    month: "short",
    day: "numeric",
  });
}

export function ChatHistorySidebar({
  open,
  onClose,
  activeConversationId,
  onSelectConversation,
  onNewChat,
}: ChatHistorySidebarProps) {
  const { t, language } = useI18n();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConversations = useCallback(async (query?: string) => {
    setLoading(true);
    try {
      const url = query
        ? `/api/ai/conversations?q=${encodeURIComponent(query)}`
        : "/api/ai/conversations";
      const response = await fetch(url);
      if (response.ok) {
        const data = (await response.json()) as {
          conversations: ConversationSummary[];
        };
        setConversations(data.conversations ?? []);
      }
    } catch {
      // Non-fatal — sidebar just shows empty.
    } finally {
      setLoading(false);
    }
  }, []);

  // Load conversations when the sidebar opens.
  useEffect(() => {
    if (open) {
      loadConversations();
      setSearchQuery("");
    }
  }, [open, loadConversations]);

  // Debounced search.
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      loadConversations();
      return;
    }
    searchTimerRef.current = setTimeout(() => {
      loadConversations(trimmed);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, loadConversations]);

  const handleDelete = useCallback(
    async (id: string, event: React.MouseEvent) => {
      event.stopPropagation();
      setDeletingId(id);
      try {
        const response = await fetch(`/api/ai/conversations/${id}`, {
          method: "DELETE",
        });
        if (response.ok) {
          setConversations((prev) => prev.filter((c) => c.id !== id));
          // If the deleted conversation was active, start a new chat.
          if (id === activeConversationId) {
            onNewChat();
          }
        }
      } catch {
        // Non-fatal — conversation may still appear until next reload.
      } finally {
        setDeletingId(null);
      }
    },
    [activeConversationId, onNewChat],
  );

  const handleNewChat = useCallback(() => {
    onNewChat();
    onClose();
  }, [onNewChat, onClose]);

  const handleSelect = useCallback(
    (id: string) => {
      onSelectConversation(id);
      onClose();
    },
    [onSelectConversation, onClose],
  );

  const panelContent = (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pb-2 pt-5">
        <button
          type="button"
          onClick={onClose}
          aria-label={t.aiChat.historyBack}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-raised hover:text-foreground min-touch-target"
        >
          <ArrowLeftIcon className="size-5" />
        </button>
        <h2 className="flex-1 text-sm font-medium tracking-tight">
          {t.aiChat.historyTitle}
        </h2>
      </div>

      {/* New chat */}
      <div className="px-3 pb-3 pt-2">
        <button
          type="button"
          onClick={handleNewChat}
          className="group relative flex min-h-11 w-full items-center gap-3 overflow-hidden rounded-xl border border-line bg-surface-raised px-3 text-left text-sm font-medium text-foreground shadow-card transition-all duration-300 hover:border-emerald-500/40 hover:shadow-glow-btn-hover active:translate-y-px min-touch-target"
        >
          <span
            aria-hidden
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-accent transition-colors duration-300 group-hover:bg-emerald-500/25"
          >
            <PlusIcon className="size-4" />
          </span>
          <span className="flex-1 truncate">{t.aiChat.newChat}</span>
        </button>
      </div>

      {/* Search */}
      {conversations.length > 0 || searchQuery ? (
        <div className="px-3 pb-2">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.aiChat.searchHistory}
              aria-label={t.aiChat.searchHistory}
              className="w-full rounded-xl border border-line bg-surface-raised py-2 pl-8 pr-3 text-xs leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-emerald-500/50"
            />
          </div>
        </div>
      ) : null}

      {/* Conversation list */}
      <nav
        className="flex-1 overflow-y-auto px-3 pb-4"
        aria-label={t.aiChat.historyTitle}
      >
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-muted">{t.common.loading}</span>
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <MessageCircleIcon className="mx-auto size-8 text-faint" />
            <p className="mt-3 text-xs text-muted">{t.aiChat.historyEmpty}</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId;
              return (
                <li key={conversation.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelect(conversation.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelect(conversation.id);
                      }
                    }}
                    className={cn(
                      "group relative flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all duration-200",
                      isActive
                        ? "bg-emerald-500/[0.12] text-accent"
                        : "text-muted hover:bg-surface-raised hover:text-foreground active:bg-surface-raised",
                    )}
                  >
                    {isActive ? (
                      <motion.span
                        layoutId="chat-history-active"
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-0.5 rounded-r-full bg-gradient-to-b from-emerald-400 to-emerald-600"
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="inline-flex size-4 shrink-0 items-center justify-center"
                      >
                        <MessageCircleIcon className="size-3.5 text-faint" />
                      </span>
                    )}
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm leading-snug",
                        isActive ? "font-medium" : "font-normal",
                      )}
                    >
                      {conversation.title}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[11px] leading-none",
                        isActive ? "text-accent/70" : "text-faint",
                      )}
                    >
                      {timeAgo(conversation.updatedAt, language)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(conversation.id, e)}
                      disabled={deletingId === conversation.id}
                      aria-label={t.common.delete}
                      className={cn(
                        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-red-500/10 hover:text-red-500",
                        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                        deletingId === conversation.id && "opacity-100 animate-pulse",
                      )}
                    >
                      <TrashIcon className="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </div>
  );

  return (
    <>
      {/* Desktop: overlay panel matching sidebar position/width */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="chat-history-desktop"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-y-0 left-0 z-50 hidden w-64 flex-col border-r border-line bg-surface shadow-phone will-change-transform lg:flex"
          >
            {panelContent}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile: slide-over drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="chat-history-mobile"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="fixed inset-0 z-50 lg:hidden"
          >
            <div
              aria-hidden
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={onClose}
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col border-r border-line bg-surface shadow-phone will-change-transform"
            >
              {panelContent}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
