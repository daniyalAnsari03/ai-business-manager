import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "md" | "lg";

type ButtonProps = {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  href?: string;
} & ComponentPropsWithoutRef<"button">;

const baseStyles =
  "inline-flex select-none items-center justify-center gap-2 rounded-full font-medium tracking-tight transition-all duration-300 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-60";
const sizeStyles: Record<ButtonSize, string> = {
  md: "min-h-11 px-5 text-sm",
  lg: "min-h-12 px-7 text-[15px]",
};

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-b from-emerald-400 to-emerald-600 text-emerald-950 ring-1 ring-inset ring-white/20 shadow-glow-btn hover:from-emerald-300 hover:to-emerald-500 hover:shadow-glow-btn-hover active:translate-y-px",
  secondary:
    "border border-line bg-surface text-foreground shadow-card hover:border-emerald-500/40 hover:text-accent active:translate-y-px",
  ghost: "text-muted hover:text-foreground",
};

/** Shared CTA control. Renders a next/link when `href` is provided. */
export function Button({
  children,
  variant = "primary",
  size = "lg",
  className,
  href,
  type,
  ...rest
}: ButtonProps) {
  const styles = cn(baseStyles, sizeStyles[size], variantStyles[variant], className);

  if (href) {
    return (
      <Link
        href={href}
        className={styles}
        {...(rest as ComponentPropsWithoutRef<"a">)}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type ?? "button"}
      className={styles}
      {...rest}
    >
      {children}
    </button>
  );
}
