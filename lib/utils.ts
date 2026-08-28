export type ClassValue = string | false | null | undefined;

/** Tiny class-name joiner (no external dependency needed). */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
