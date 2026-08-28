import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow: ReactNode;
  /** Node so pages can highlight parts of the heading (e.g. business name). */
  title: ReactNode;
  subtitle: string;
  /** Optional right-aligned action (e.g. the Add Product CTA). */
  action?: ReactNode;
};

/**
 * Shared authenticated-page header: lifted surface, corner emerald glow,
 * eyebrow + display title + supporting line. Keeps Dashboard and module
 * pages on one visual rhythm (AGENTS.md §16/§17).
 */
export function PageHeader({ eyebrow, title, subtitle, action }: PageHeaderProps) {
  return (
    <header className="relative overflow-hidden rounded-[1.75rem] border border-line bg-surface px-6 py-8 shadow-card sm:px-9 sm:py-10">
      <div
        aria-hidden
        className="ambient-glow -right-24 -top-32 size-[380px]"
      />
      <div className="relative flex flex-wrap items-end justify-between gap-5">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1 className="mt-4 font-display text-display-md font-light text-balance">
            {title}
          </h1>
          <p className="mt-2 max-w-xl text-[15px] text-muted">{subtitle}</p>
        </div>
        {action}
      </div>
    </header>
  );
}
