"use client";

import type { SelectHTMLAttributes } from "react";
import { AlertCircleIcon, ChevronDownIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

type SelectFieldProps = {
  label: string;
  id: string;
  hint?: string;
  error?: string;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className">;

/** Labeled native select — reliable and familiar on every device. */
export function SelectField({
  label,
  id,
  hint,
  error,
  required,
  children,
  ...rest
}: SelectFieldProps) {
  const descriptionId = hint || error ? `${id}-description` : undefined;

  return (
    <div className="w-full">
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-foreground"
      >
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-accent">
            *
          </span>
        ) : null}
      </label>
      <div className="relative">
        <select
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={descriptionId}
          className={cn(
            "min-h-12 w-full appearance-none rounded-xl border bg-surface px-4 pr-11 text-[15px] text-foreground shadow-card",
            "transition-colors duration-200",
            "focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/25",
            error
              ? "border-faint"
              : "border-line hover:border-emerald-500/30",
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDownIcon
          aria-hidden
          className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-faint"
        />
      </div>
      {hint && !error ? (
        <p id={descriptionId} className="mt-1.5 text-xs leading-relaxed text-faint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={descriptionId}
          role="alert"
          className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted"
        >
          <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
