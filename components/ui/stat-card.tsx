import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatCardProps = {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: "warning" | "danger";
};

/** Compact lifted metric card shared by the business module views. */
export function StatCard({ icon, label, value, tone }: StatCardProps) {
  return (
    <Card lift={false} className="flex items-center gap-4 !p-5">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl",
          tone === "warning"
            ? "bg-foreground/[0.06] text-foreground"
            : tone === "danger"
              ? "bg-foreground/[0.1] text-foreground"
              : "bg-emerald-500/10 text-accent",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs uppercase tracking-widest text-faint">
          {label}
        </p>
        <p className="font-display text-2xl font-light leading-tight">{value}</p>
      </div>
    </Card>
  );
}
