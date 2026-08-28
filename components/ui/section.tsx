import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionProps = {
  id?: string;
  children: ReactNode;
  className?: string;
  /** Accessible label when the section has no visible heading. */
  ariaLabel?: string;
};

/**
 * Vertical rhythm + positioning context for ambient glows.
 * Padding scales from small mobile up to large desktop (AGENTS.md §21).
 */
export function Section({ id, children, className, ariaLabel }: SectionProps) {
  return (
    <section
      id={id}
      aria-label={ariaLabel}
      className={cn("relative scroll-mt-24 py-20 sm:py-24 lg:py-28", className)}
    >
      {children}
    </section>
  );
}

type SectionHeadingProps = {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
  className?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        align === "center" ? "items-center text-center" : "items-start",
        className,
      )}
    >
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <h2 className="max-w-2xl font-display text-display-lg font-light text-balance">
        {title}
      </h2>
      {description ? (
        <p
          className={cn(
            "max-w-xl text-base leading-relaxed text-muted sm:text-lg",
            align === "center" ? "mx-auto" : "",
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
