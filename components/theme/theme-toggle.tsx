"use client";

import { useTheme } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";
import { MoonIcon, SunIcon } from "@/components/ui/icons";

type ThemeToggleProps = {
  className?: string;
};

/**
 * Icon-only theme switch. Visibility is driven purely by the `.dark` class on
 * <html>, so server and client markup always match (no hydration flash).
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Switch between dark and light mode"
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full",
        "border border-line bg-surface text-muted shadow-card",
        "transition-colors duration-200 hover:border-emerald-500/40 hover:text-accent",
        "min-touch-target",
        className,
      )}
    >
      <SunIcon className="hidden size-[18px] dark:block" />
      <MoonIcon className="block size-[18px] dark:hidden" />
    </button>
  );
}
