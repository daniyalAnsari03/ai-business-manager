/**
 * Product unit labels (docs/p4.txt — File 3 / Prompt 4).
 *
 * Pure TypeScript: no database access, no server-only imports, so it can be
 * unit tested offline and imported from anywhere (client or server).
 *
 * A unit is a LABEL. Stock quantities stay whole numbers: no quantity column
 * and no quantity arithmetic changes because of this file. "2 Meter" is two
 * counted pieces of fabric, not a fractional quantity.
 *
 * Two rules shape everything here:
 *
 *  1. Never invent a value. This module only decides how an owner-supplied
 *     label is spelled and stored; it never supplies one. Deciding what "not
 *     provided" means is the CALLER's job (a form may default to
 *     DEFAULT_UNIT, an AI tool may ask).
 *  2. Never silently coerce. Anything not understood is a reported error, not
 *     a best-effort guess — an error the caller (and the AI acting on the
 *     owner's behalf) must see rather than paper over.
 */

/** Maximum length of a stored unit label, in characters, after normalisation.
 *  Matches the `products_unit_length` check constraint exactly. */
export const UNIT_MAX_LENGTH = 30;

/**
 * The predefined unit labels offered to the owner, in display order.
 *
 * This is a SUGGESTION list, never a whitelist: FILE 3 is predefined PLUS
 * custom, because "Carton", "Bundle", "Bag" and "Pair" are all real units and
 * nobody's option list can enumerate everything a shop sells. A value that
 * matches none of these is stored as a custom label in the casing it was
 * typed.
 *
 * "Other" is the escape-hatch entry the owner picks before typing their own.
 *
 * Edit this list to match a market or a franchise's catalogue; the normaliser
 * picks the change up automatically and the offline tests still cover it.
 */
export const UNIT_OPTIONS = [
  "Piece",
  "Meter",
  "Yard",
  "Set",
  "Dozen",
  "Other",
] as const;

/** Stored label a caller may use when the owner did not pick a unit. */
export const DEFAULT_UNIT = "Piece";

/** Stored, human-readable problem. Deterministic, safe to show. */
export type ProductUnitError = {
  /** Stable machine-readable reason. */
  code: "not_a_string" | "empty" | "too_long";
  /** English explanation. Localise at the presentation layer. */
  message: string;
};

export type ProductUnitResult =
  | { ok: true; unit: string }
  | { ok: false; error: ProductUnitError };

/**
 * Trims and collapses runs of internal whitespace to a single space. This is
 * the form a label is stored in, so "  Meter " and "Meter" are the same unit
 * rather than two, and "Per   Piece" is stored as "Per Piece".
 */
function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Lookup key for a label: whitespace collapsed and lowercased. Built from the
 * same function the matcher uses, so a list entry can never become
 * unreachable.
 */
const CANONICAL_BY_MATCH_KEY: Readonly<Record<string, string>> =
  UNIT_OPTIONS.reduce<Record<string, string>>((acc, option) => {
    acc[option.toLowerCase()] = option;
    return acc;
  }, Object.create(null) as Record<string, string>);

/**
 * The predefined label a stored unit matches, or null when it is a custom label
 * nobody could enumerate ("Carton", "Bundle", "Pair").
 *
 * Matching uses the same normalisation the normaliser stores with (whitespace
 * collapsed, case ignored), so a UI can decide "picker choice or the owner's own
 * text" from a stored label without ever disagreeing with the server.
 *
 * Pass the list the picker actually renders: a label filtered out of it must not
 * match, or a select would be asked to show a choice it cannot display.
 */
export function matchUnitOption(
  value: string,
  options: readonly string[] = UNIT_OPTIONS,
): string | null {
  const key = collapseWhitespace(value).toLowerCase();
  if (key === "") return null;
  for (const option of options) {
    if (option.toLowerCase() === key) return option;
  }
  return null;
}

/**
 * Normalises raw unit input and returns the exact label to store.
 *
 * - The input is trimmed and its internal whitespace collapsed.
 * - A value matching a predefined option (ignoring case) is stored in that
 *   option's canonical spelling, so the same unit never ends up saved as
 *   "meter" on one product and "Meter" on the next.
 * - Anything else is a CUSTOM value and is always allowed, kept in the casing
 *   it was typed. It must be at most UNIT_MAX_LENGTH characters once
 *   normalised, so padding never rejects a usable value and never buys extra
 *   length.
 * - Empty (including whitespace-only) and non-string input are ERRORS, never
 *   defaults: "not provided" is the caller's decision to make, not this
 *   module's. A caller that wants DEFAULT_UNIT must apply it deliberately.
 */
export function normalizeUnit(input: unknown): ProductUnitResult {
  if (typeof input !== "string") {
    return {
      ok: false,
      error: {
        code: "not_a_string",
        message: "Product unit must be text.",
      },
    };
  }

  const collapsed = collapseWhitespace(input);
  if (collapsed === "") {
    return {
      ok: false,
      error: {
        code: "empty",
        message: "Product unit cannot be empty.",
      },
    };
  }

  // Measured after normalisation, so padding never rejects a usable value.
  if (collapsed.length > UNIT_MAX_LENGTH) {
    return {
      ok: false,
      error: {
        code: "too_long",
        message: `Product unit must be ${UNIT_MAX_LENGTH} characters or fewer.`,
      },
    };
  }

  return { ok: true, unit: CANONICAL_BY_MATCH_KEY[collapsed.toLowerCase()] ?? collapsed };
}
