import "server-only";

export function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function comparablePhoneKey(value: string): string {
  let digits = normalizePhoneDigits(value);
  digits = digits.replace(/^0+/, "");
  if (digits.length > 10 && digits.startsWith("92")) {
    digits = digits.slice(2);
  }
  return digits;
}

export function matchesBusinessPhone(
  stored: string | null,
  other: string,
): boolean {
  if (!stored || !other) return false;
  return comparablePhoneKey(stored) === comparablePhoneKey(other);
}