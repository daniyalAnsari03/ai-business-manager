import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type CardProps = {
  children: ReactNode;
  className?: string;
  /** Enable the subtle hover-lift interaction. */
  lift?: boolean;
};

/**
 * Lifted surface card (AGENTS.md §16): layered depth, soft shadow,
 * slight border contrast and an opt-in hover lift.
 */
export function Card({ children, className, lift = true }: CardProps) {
  return (
    <div className={cn("card-surface", lift && "card-lift", "p-6", className)}>
      {children}
    </div>
  );
}
