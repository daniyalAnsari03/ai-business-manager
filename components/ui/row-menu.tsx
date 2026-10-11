"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { MoreVerticalIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export type RowMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  /** Destructive items render in the danger style and belong last. */
  danger?: boolean;
  disabled?: boolean;
  /** Explained to the user (and to assistive tech) when the item is disabled. */
  disabledReason?: string;
};

type RowMenuProps = {
  /** Accessible name for the trigger, e.g. "Actions for Karachi Textiles". */
  label: string;
  items: RowMenuItem[];
};

/**
 * Shared 3-dot (kebab) row-actions menu (AGENTS.md §23).
 *
 * One small accessible component used by every module so delete/confirm
 * behaviour stays consistent: a labelled trigger with `aria-haspopup`, a
 * `role="menu"` surface, Escape/outside-click to dismiss, arrow/Home/End
 * keyboard navigation, and focus returned to the trigger on close.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const first = itemRefs.current.find((el) => el && !el.disabled);
    first?.focus();
  }, [open]);

  function focusByOffset(offset: number) {
    const enabled = itemRefs.current.filter(
      (el): el is HTMLButtonElement => el !== null && !el.disabled,
    );
    if (enabled.length === 0) return;
    const current = document.activeElement as HTMLButtonElement | null;
    const index = current ? enabled.indexOf(current) : -1;
    enabled[(index + offset + enabled.length) % enabled.length]?.focus();
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusByOffset(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusByOffset(-1);
        break;
      case "Home":
        event.preventDefault();
        itemRefs.current.find((el) => el && !el.disabled)?.focus();
        break;
      case "End":
        event.preventDefault();
        [...itemRefs.current].reverse().find((el) => el && !el.disabled)?.focus();
        break;
      default:
        break;
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative inline-flex"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-raised hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/25 min-touch-target"
      >
        <MoreVerticalIcon className="size-4" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full z-40 mt-1 min-w-44 overflow-hidden rounded-xl border border-line bg-surface-raised p-1 shadow-phone"
        >
          {items.map((item, index) => (
            <button
              key={item.key}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              aria-disabled={item.disabled || undefined}
              title={item.disabled ? item.disabledReason : undefined}
              onClick={() => {
                if (item.disabled) return;
                close();
                item.onSelect();
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                item.disabled
                  ? "cursor-not-allowed text-faint"
                  : item.danger
                    ? "text-foreground hover:bg-foreground/[0.06]"
                    : "text-foreground hover:bg-surface",
              )}
            >
              {item.icon ? (
                <span aria-hidden className="shrink-0 text-muted">
                  {item.icon}
                </span>
              ) : null}
              <span className="flex-1">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
