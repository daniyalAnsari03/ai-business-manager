/**
 * Form helpers for the product attribute pickers and the unit label
 * (docs/p4.txt — File 3 / Phase 2, Part B).
 *
 * Pure TypeScript: no database, no server-only imports, no React. The client
 * form uses it for instant feedback and the offline tests exercise it directly,
 * so what the picker shows and what the service stores are decided in ONE place
 * instead of drifting apart.
 *
 * The rules this file must never break:
 *
 *  1. Never invent a value. A field nobody filled in produces no key at all —
 *     not "", not a default.
 *  2. Never silently coerce. Matching a stored value to a picker choice uses the
 *     SAME rules the server stores with; anything that matches nothing stays the
 *     owner's own text (custom values are always allowed).
 *  3. Removal is explicit. Clearing a field on an EXISTING product produces a
 *     clear list naming that key, never a silent "replace the whole bag".
 */
import {
  CLOTHING_ATTRIBUTE_KEYS,
  CLOTHING_ATTRIBUTE_OPTIONS,
  matchAttributeOption,
  normalizeProductAttributes,
  type ClothingAttributeKey,
  type ProductAttributes,
} from "@/lib/business/product-attributes";
import {
  DEFAULT_UNIT,
  UNIT_OPTIONS,
  matchUnitOption,
  normalizeUnit,
} from "@/lib/business/product-units";
import { hasCapability } from "@/lib/business/type-config";
import {
  validateOptionalCostPrice,
  type ProductFieldError,
} from "@/lib/products/validation";

/** The select option that reveals the owner's own text input. */
export const CUSTOM_VALUE = "__custom__";

/**
 * Option names that are ESCAPE HATCHES rather than real values: picking one
 * means "I will type my own", never "store the word Other". They are removed
 * from the rendered list and replaced by the single custom choice, so the owner
 * never sees two entries that lead to the same place.
 */
const ESCAPE_HATCH_LABELS: ReadonlySet<string> = new Set(["other", "custom"]);

/**
 * One picker field: a predefined choice, the owner's own text, or nothing yet.
 * `choice` holds an option value, CUSTOM_VALUE, or "" for "not chosen".
 */
export interface OptionFieldState {
  choice: string;
  custom: string;
}

/** A field the owner has not touched. */
export function emptyOptionField(): OptionFieldState {
  return { choice: "", custom: "" };
}

/**
 * The options a picker renders for one list: every predefined value except the
 * escape hatch, then the custom choice last. `custom: true` entries render with
 * a translated label instead of the stored spelling.
 */
export interface OptionEntry {
  value: string;
  custom: boolean;
}

function isEscapeHatch(option: string): boolean {
  return ESCAPE_HATCH_LABELS.has(option.trim().toLowerCase());
}

/** Predefined options (escape hatch removed) plus the custom choice. */
export function optionEntries(options: readonly string[]): OptionEntry[] {
  return [
    ...options.filter((option) => !isEscapeHatch(option)).map((option) => ({
      value: option,
      custom: false,
    })),
    { value: CUSTOM_VALUE, custom: true },
  ];
}

/** The predefined clothing options a picker renders for one attribute key. */
export function clothingOptionEntries(key: ClothingAttributeKey): OptionEntry[] {
  return optionEntries(CLOTHING_ATTRIBUTE_OPTIONS[key]);
}

/** The predefined unit labels a picker renders. */
export function unitOptionEntries(): OptionEntry[] {
  return optionEntries(UNIT_OPTIONS);
}

/**
 * Turns a stored value into the field state that shows it: a choice when it
 * matches one of the RENDERED options, the owner's own text when it matches
 * none, and nothing when it was never recorded.
 *
 * Matching runs against the rendered options only, so a stored value can never
 * end up pointing a select at an entry that is not there — and the match itself
 * is the server's matcher, so the form and the stored spelling cannot disagree.
 */
export function optionFieldFromValue(
  stored: string | null | undefined,
  entries: readonly OptionEntry[],
  match: (value: string, rendered: readonly string[]) => string | null,
): OptionFieldState {
  if (typeof stored !== "string" || stored.trim() === "") return emptyOptionField();
  const rendered = entries
    .filter((entry) => !entry.custom)
    .map((entry) => entry.value);
  const option = match(stored, rendered);
  return option !== null
    ? { choice: option, custom: "" }
    : { choice: CUSTOM_VALUE, custom: stored };
}

/** Stored value behind a field: an option, the typed text, or "" for nothing. */
export function optionFieldValue(field: OptionFieldState): string {
  if (field.choice === "") return "";
  if (field.choice === CUSTOM_VALUE) return field.custom.trim();
  return field.choice;
}

/** True when the field currently holds nothing at all. */
export function isOptionFieldEmpty(field: OptionFieldState): boolean {
  return optionFieldValue(field) === "";
}

/** Every clothing attribute as a field state, preloaded from a stored product. */
export function clothingFieldsFromAttributes(
  attributes: ProductAttributes,
): Record<ClothingAttributeKey, OptionFieldState> {
  const fields = {} as Record<ClothingAttributeKey, OptionFieldState>;
  for (const key of CLOTHING_ATTRIBUTE_KEYS) {
    fields[key] = optionFieldFromValue(
      attributes[key],
      clothingOptionEntries(key),
      matchAttributeOption,
    );
  }
  return fields;
}

/** The unit field preloaded from a stored product (defaults to Piece). */
export function unitFieldFromLabel(stored: string | null | undefined): OptionFieldState {
  return optionFieldFromValue(
    typeof stored === "string" && stored.trim().length > 0 ? stored : DEFAULT_UNIT,
    unitOptionEntries(),
    matchUnitOption,
  );
}

/** What an update sends: the values to store, and the keys to remove. */
export interface AttributePayload {
  attributes: ProductAttributes;
  clearAttributes: ClothingAttributeKey[];
}

/**
 * Builds the attributes patch and the clear list from the form state.
 *
 * `stored` is what the product holds NOW (the values the form was preloaded
 * with), and the patch is a DIFF against it:
 *
 *  - a key the owner left exactly as it was is not sent at all, so an edit that
 *    only renames a product cannot rewrite — let alone damage — attributes;
 *  - a key the owner emptied is named in `clearAttributes`, because "not
 *    supplied" would otherwise leave the old value in place;
 *  - a key the owner changed is sent with their own spelling, and the service
 *    canonicalises it and merges it onto the stored bag.
 *
 * The comparison ignores case and spacing, because those are exactly the
 * differences the server would normalise away: sending them again would be a
 * write that says nothing.
 */
export function buildAttributePayload(
  stored: ProductAttributes,
  fields: Record<ClothingAttributeKey, OptionFieldState>,
): AttributePayload {
  const attributes: ProductAttributes = {};
  const clearAttributes: ClothingAttributeKey[] = [];
  for (const key of CLOTHING_ATTRIBUTE_KEYS) {
    const value = optionFieldValue(fields[key]);
    const previous = stored[key];
    const hadPrevious = typeof previous === "string" && previous.trim() !== "";
    if (value !== "") {
      if (!hadPrevious || !sameValue(previous as string, value)) attributes[key] = value;
      continue;
    }
    if (hadPrevious) clearAttributes.push(key);
  }
  return { attributes, clearAttributes };
}

/** Two spellings of the same thing: whitespace runs and case do not count. */
function sameValue(a: string, b: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalize(a) === normalize(b);
}

/** True when an update has nothing to write and nothing to remove. */
export function isEmptyAttributePayload(payload: AttributePayload): boolean {
  return (
    Object.keys(payload.attributes).length === 0 && payload.clearAttributes.length === 0
  );
}

/**
 * The attribute chips a product card shows: the stored values that actually
 * exist, in the fixed clothing order. Nothing is invented for a product with no
 * attributes, and a blank value is never shown as an empty chip.
 */
export function attributeChipValues(attributes: ProductAttributes): string[] {
  const values: string[] = [];
  for (const key of CLOTHING_ATTRIBUTE_KEYS) {
    const value = attributes[key];
    if (typeof value === "string" && value.trim() !== "") values.push(value.trim());
  }
  return values;
}

/* ---------------------------------------------------------------------------
 * Field validation: the FORM asks the SERVICE-layer validators
 * ------------------------------------------------------------------------ */

/**
 * Every attribute error code mapped onto the shared product field-error codes,
 * so the form can localise it with the same messages it already uses for the
 * name and price instead of showing the validator's English sentence.
 */
function attributeErrorToFieldError(code: string): ProductFieldError {
  return code === "too_long" ? "too_long" : "required";
}

/**
 * Validates the attribute pickers with the REAL validator and returns the
 * per-key field errors. The values are passed through exactly as typed — the
 * validator owns canonical spelling ("lawn" becomes "Lawn" server-side), so the
 * form never stores its own guess.
 */
export function validateAttributeFields(
  businessType: unknown,
  fields: Record<ClothingAttributeKey, OptionFieldState>,
): Partial<Record<ClothingAttributeKey, ProductFieldError>> {
  const errors: Partial<Record<ClothingAttributeKey, ProductFieldError>> = {};
  // A business type with no attribute vocabulary has no fields to validate.
  if (!hasCapability(businessType, "fabric_attributes")) return errors;

  const candidate: ProductAttributes = {};
  for (const key of CLOTHING_ATTRIBUTE_KEYS) {
    const value = optionFieldValue(fields[key]);
    if (value !== "") candidate[key] = value;
  }

  const result = normalizeProductAttributes(businessType, candidate);
  if (result.ok) return errors;
  for (const error of result.errors) {
    // A whole-object problem has no key; it is reported on the first field that
    // can carry it rather than being swallowed.
    const key = CLOTHING_ATTRIBUTE_KEYS.find((name) => name === error.key);
    if (key && errors[key] === undefined) {
      errors[key] = attributeErrorToFieldError(error.code);
    }
  }
  return errors;
}

/** Validates the unit field with the real unit normaliser. */
export function validateUnitField(field: OptionFieldState): ProductFieldError | null {
  const result = normalizeUnit(optionFieldValue(field));
  if (result.ok) return null;
  return result.error.code === "too_long" ? "too_long" : "required";
}

/**
 * Validates the cost price field with the real money rules. A blank field is
 * fine (no cost recorded); anything else must be a real amount.
 */
export function validateCostPriceField(value: string): ProductFieldError | null {
  const result = validateOptionalCostPrice(value);
  return result.ok ? null : result.error;
}

/* ---------------------------------------------------------------------------
 * The cost price: setting it, keeping it, and erasing it (docs/p5.txt)
 * ------------------------------------------------------------------------ */

/** What an update sends about the cost price — never both instructions. */
export interface CostPriceExtras {
  costPrice?: string;
  clearCostPrice?: true;
}

/**
 * Decides the ONE cost-price instruction an update sends.
 *
 *  - a typed amount replaces the saved cost price;
 *  - `clear` (the owner pressed "Remove cost price") erases it;
 *  - an empty field sends NOTHING at all, so saving an unrelated edit can never
 *    destroy a recorded cost price just because the box happens to be empty —
 *    that is exactly the trap this function exists to make impossible.
 *
 * A typed amount always wins over a pending removal: someone who types an amount
 * has plainly said what the cost is, not that there is none.
 */
export function buildCostPriceExtras(value: string, clear: boolean): CostPriceExtras {
  if (value.trim() !== "") return { costPrice: value };
  if (clear) return { clearCostPrice: true };
  return {};
}
