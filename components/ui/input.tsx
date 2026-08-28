"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { AlertCircleIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

type TextFieldProps = {
  label: string;
  /** Unique id; also used for the aria wiring between label/input/description. */
  id: string;
  hint?: string;
  error?: string;
  /** Element rendered inside the field's right edge (e.g. password toggle). */
  trailing?: ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">;

/** Labeled text field following the premium surface language. */
export function TextField({
  label,
  id,
  hint,
  error,
  trailing,
  required,
  ...rest
}: TextFieldProps) {
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
        <input
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={descriptionId}
          className={cn(
            "min-h-12 w-full rounded-xl border bg-surface px-4 text-[15px] text-foreground shadow-card",
            "placeholder:text-faint transition-colors duration-200",
            "focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/25",
            trailing ? "pr-12" : undefined,
            error
              ? "border-faint"
              : "border-line hover:border-emerald-500/30",
          )}
          {...rest}
        />
        {trailing ? (
          <div className="absolute inset-y-0 right-0 flex items-center pr-2">
            {trailing}
          </div>
        ) : null}
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
