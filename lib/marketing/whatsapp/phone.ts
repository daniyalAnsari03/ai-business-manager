import "server-only";

/** Strips every non-digit character from a phone value. */
export function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Canonical comparable key for a phone value.
 *
 * Local and international formats collapse on purpose so that
 * `03282241956 ≡ 923282241956 ≡ "+92 328 2241956"` all reduce to the same
 * 10-digit national key (`3282241956`).
 *
 * Steps (after stripping non-digits):
 *   - a leading "00" international prefix is dropped;
 *   - a leading trunk "0" (the local dialling prefix) is dropped;
 *   - when the remaining value is a valid Pakistani international number —
 *     exactly 12 digits starting with country code "92" — the "92" is dropped
 *     to reach the same national key.
 *
 * Only the exact 12-digit "92x..." international shape is shortened. A
 * malformed value (e.g. an 11-digit "92282241956" that lost a digit) stays
 * as-is so it can never silently collapse into the key of a real number.
 */
export function comparablePhoneKey(value: string): string {
  let digits = normalizePhoneDigits(value);
  if (digits.startsWith("00")) digits = digits.slice(2);
  digits = digits.replace(/^0+/, "");
  if (digits.length === 12 && digits.startsWith("92")) {
    digits = digits.slice(2);
  }
  return digits;
}

/**
 * True when two phone values refer to the same number, tolerant of local vs
 * international formatting. A degenerate value (fewer than 6 digits) is not a
 * real phone number and never matches.
 */
export function matchesBusinessPhone(
  stored: string | null,
  other: string,
): boolean {
  if (!stored || !other) return false;
  const storedKey = comparablePhoneKey(stored);
  const otherKey = comparablePhoneKey(other);
  if (storedKey.length < 6 || otherKey.length < 6) return false;
  return storedKey === otherKey;
}

/**
 * Converts a stored phone value to E.164 digits (no "+") for sending through
 * the WhatsApp Cloud API, which requires a full international number.
 *
 * A locally-stored Pakistani mobile like `03282241956` is converted to
 * `923282241956`. Best-effort: anything unrecognised is returned as its
 * digit-only form.
 */
export function toE164Digits(value: string): string {
  let digits = normalizePhoneDigits(value);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (
    !digits.startsWith("92") &&
    digits.length === 10 &&
    /^3\d{9}$/.test(digits)
  ) {
    digits = "92" + digits;
  }
  return digits;
}