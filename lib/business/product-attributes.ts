/**
 * Product attributes: the per-product vocabulary a business type can have
 * (docs/p4.txt — File 3 / Prompt 4).
 *
 * Pure TypeScript: no database access, no server-only imports, so it can be
 * unit tested offline and imported from anywhere (client or server).
 *
 * Three rules shape everything here:
 *
 *  1. Never invent a value. An attribute the caller did not supply stays
 *     absent from the result; a blank value is dropped, not turned into "".
 *  2. Never silently coerce. Anything the validator does not understand is a
 *     reported error, not a best-effort guess — an error the caller (and the
 *     AI acting on the owner's behalf) must see rather than paper over.
 *  3. Never let a stored value outlive its vocabulary. Validation only accepts
 *     values for a business type that HAS the capability, and the readable
 *     view of a product is empty for a type that no longer has it — so a
 *     business that stops being a clothing shop stops being offered clothing
 *     fields, while the data it already saved is left untouched.
 */
import { hasCapability } from "@/lib/business/type-config";

/** Storage shape: a plain JSON object of optional string values. */
export type ProductAttributes = Record<string, string>;

/** Keys a clothing/fashion product can carry. All are optional. */
export const CLOTHING_ATTRIBUTE_KEYS = [
  "product_type",
  "fabric",
  "color",
  "design",
  "size",
] as const;

export type ClothingAttributeKey = (typeof CLOTHING_ATTRIBUTE_KEYS)[number];

/** Maximum length of a single attribute value, in characters. */
export const ATTRIBUTE_VALUE_MAX_LENGTH = 60;

/**
 * Suggested values per key, so a UI can offer a picker instead of a blank box.
 *
 * These are SUGGESTIONS, never a whitelist: every key also accepts a custom
 * value, because "Chikankari" is a real design and nobody's option list can
 * enumerate everything a shop sells. When a supplied value matches one of
 * these — ignoring case, extra whitespace and the spacing around "/" and "+" —
 * the canonical spelling below is what gets stored, so the same attribute does
 * not end up saved as "shirt/kameez" on one product and "Shirt / Kameez" on the
 * next. Anything else is stored as a custom value in the casing it was typed.
 *
 * `color` intentionally has no long fixed list: it is predefined plus custom.
 *
 * Edit this block to match a market or a franchise's catalogue; the validator
 * picks the change up automatically and the offline tests still cover it.
 */
export const CLOTHING_ATTRIBUTE_OPTIONS: Record<
  ClothingAttributeKey,
  readonly string[]
> = {
  product_type: [
    "Suit",
    "Fabric",
    "Dupatta",
    "Shirt / Kameez",
    "Trouser",
    "Shawl",
    "Saree",
    "Lehenga",
    "Abaya",
    "Kurta / Kurti",
    "Co-ord Set",
    "Other",
  ],
  fabric: [
    "Cotton",
    "Lawn",
    "Chiffon",
    "Silk",
    "Linen",
    "Khaddar",
    "Jacquard",
    "Velvet",
    "Organza",
    "Georgette",
    "Net",
    "Cambric",
    "Khadi",
    "Other",
  ],
  color: [
    "Black",
    "White",
    "Red",
    "Blue",
    "Green",
    "Yellow",
    "Pink",
    "Purple",
    "Orange",
    "Brown",
    "Grey",
    "Beige",
    "Maroon",
    "Navy",
    "Other",
  ],
  design: [
    "Plain",
    "Printed",
    "Embroidered",
    "Jacquard",
    "Zari Work",
    "Handwork",
    "Sequins Work",
    "Thread Work",
    "Digital Print",
    "Block Print",
    "Embroidery + Handwork",
    "Embroidery + Zari",
    "Other",
  ],
  size: ["Small", "Medium", "Large", "XL", "XXL", "Free Size", "Custom"],
};

/**
 * The predefined option a value matches inside one key's list, or null when it
 * matches none of them (a custom value).
 *
 * Matching uses the SAME rules the validator stores with — whitespace collapsed,
 * spacing around "/" and "+" ignored, case ignored — so a UI can decide "picker
 * choice or the owner's own text" from the stored value and never disagree with
 * what the server would have stored.
 *
 * Pass the list that is actually rendered: an option filtered out of the picker
 * must not match, or a select would be asked to show a value it cannot display.
 */
export function matchAttributeOption(
  value: string,
  options: readonly string[],
): string | null {
  const key = matchKey(value);
  if (key === "") return null;
  for (const option of options) {
    if (matchKey(option) === key) return option;
  }
  return null;
}

/**
 * Trims and collapses runs of internal whitespace to a single space. This is
 * the form a value is stored in, so "  Chikankari   Special " and
 * "Chikankari Special" are the same attribute rather than two.
 */
function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Lookup key for a value: whitespace collapsed, spacing around the "/" and "+"
 * separators removed (so "shirt/kameez", "Shirt /Kameez" and "SHIRT / KAMEEZ"
 * all share one key), and lowercased.
 */
function matchKey(value: string): string {
  return collapseWhitespace(value)
    .replace(/\s*([/+])\s*/g, "$1")
    .toLowerCase();
}

/**
 * Fast lookup from a match key to the canonical spelling of an option. Built
 * through the same key function the matcher uses, so a list entry can never
 * become unreachable.
 */
const CANONICAL_BY_MATCH_KEY: Readonly<Record<string, string>> = Object.values(
  CLOTHING_ATTRIBUTE_OPTIONS,
).reduce<Record<string, string>>((acc, options) => {
  for (const option of options) {
    const key = matchKey(option);
    // First spelling wins, so the map never depends on object key order.
    if (!(key in acc)) acc[key] = option;
  }
  return acc;
}, Object.create(null) as Record<string, string>);

const CLOTHING_KEY_SET: ReadonlySet<string> = new Set<string>(
  CLOTHING_ATTRIBUTE_KEYS,
);

/** Stored, human-readable problems. Deterministic order, safe to show. */
export type ProductAttributeError = {
  /** Attribute key, or "" for a whole-object problem. */
  key: string;
  /** Stable machine-readable reason. */
  code:
    | "not_an_object"
    | "unknown_key"
    | "not_a_string"
    | "too_long"
    | "not_supported_for_business_type";
  /** English explanation. Localise at the presentation layer. */
  message: string;
};

export type ProductAttributeResult =
  | { ok: true; attributes: ProductAttributes }
  | { ok: false; errors: ProductAttributeError[] };

/**
 * Returns the value to store for an already-whitespace-collapsed value: the
 * canonical spelling of the matching option, or the value itself (trimmed,
 * internal whitespace collapsed, original casing kept) when nothing matches,
 * which makes it a custom value. Custom values are always allowed.
 */
function canonicalizeValue(collapsed: string): string {
  return CANONICAL_BY_MATCH_KEY[matchKey(collapsed)] ?? collapsed;
}

/**
 * Validates raw product attributes for a business type and returns the exact
 * object to store.
 *
 * - For business types with the `fabric_attributes` capability (today only
 *   `clothing_fashion`), the input must be an object using only the known
 *   clothing keys. Every value must be a string; it is trimmed with internal
 *   whitespace collapsed, must then be at most ATTRIBUTE_VALUE_MAX_LENGTH
 *   characters, and is stored in the canonical spelling of the option it
 *   matches (ignoring case and the spacing around "/" and "+"). Anything that
 *   matches no option is kept as a custom value in the casing it was typed.
 *   Values that are blank after normalisation are dropped rather than stored
 *   empty. Unknown keys and non-string values are errors, never ignored.
 * - For every other business type the attributes object must be empty for
 *   now: the vocabulary does not exist yet, so anything else is rejected
 *   rather than stored somewhere it can never be read.
 *
 * An unknown or malformed business type resolves through type-config's own
 * fallback to "other", and therefore takes the empty-object rules.
 */
export function normalizeProductAttributes(
  businessType: unknown,
  input: unknown,
): ProductAttributeResult {
  // null and undefined mean "no attributes supplied" and are treated as {}.
  if (input === null || input === undefined) {
    return validateAttributes(businessType, {});
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      errors: [
        {
          key: "",
          code: "not_an_object",
          message: "Product attributes must be a JSON object.",
        },
      ],
    };
  }
  return validateAttributes(
    businessType,
    input as Record<string, unknown>,
  );
}

function validateAttributes(
  businessType: unknown,
  input: Record<string, unknown>,
): ProductAttributeResult {
  const errors: ProductAttributeError[] = [];
  const supportsAttributes = hasCapability(
    businessType,
    "fabric_attributes",
  );

  if (!supportsAttributes) {
    for (const key of Object.keys(input)) {
      errors.push({
        key,
        code: "not_supported_for_business_type",
        message: `Product attribute "${key}" is not supported for this business type.`,
      });
    }
    return errors.length > 0
      ? { ok: false, errors }
      : { ok: true, attributes: {} };
  }

  const attributes: ProductAttributes = {};

  for (const [key, value] of Object.entries(input)) {
    if (!CLOTHING_KEY_SET.has(key)) {
      errors.push({
        key,
        code: "unknown_key",
        message: `Unknown product attribute "${key}".`,
      });
      continue;
    }
    if (typeof value !== "string") {
      errors.push({
        key,
        code: "not_a_string",
        message: `Product attribute "${key}" must be text.`,
      });
      continue;
    }
    const collapsed = collapseWhitespace(value);
    // Measured after normalisation, so padding never rejects a usable value.
    if (collapsed.length > ATTRIBUTE_VALUE_MAX_LENGTH) {
      errors.push({
        key,
        code: "too_long",
        message: `Product attribute "${key}" must be ${ATTRIBUTE_VALUE_MAX_LENGTH} characters or fewer.`,
      });
      continue;
    }
    // Blank after normalisation: drop it. Missing stays missing; never store "".
    if (collapsed !== "") attributes[key] = canonicalizeValue(collapsed);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, attributes };
}

/**
 * Reads the attributes bag back out of a stored row, keeping only string
 * values: that is the only shape the write validators produce, so a non-string
 * can only come from a hand-written SQL insert. Nothing is coerced into a value
 * nobody entered — an unreadable entry is left out rather than invented.
 *
 * This is the RAW stored bag. Use {@link readableProductAttributes} for anything
 * the owner or the AI is allowed to see.
 */
export function storedProductAttributes(value: unknown): ProductAttributes {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const attributes: ProductAttributes = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") attributes[key] = item;
  }
  return attributes;
}

/**
 * The attributes a business of THIS type is allowed to READ.
 *
 * Attributes belong to a business type's own vocabulary. A shop that never had
 * the `fabric_attributes` capability can still hold attributes on a row — it was
 * a clothing shop once, or the values were written while the type was clothing
 * — and showing "cotton, black" on a grocery product would be a fact this
 * business cannot use and does not understand. So the read hides them.
 *
 * Nothing is deleted or rewritten: the stored bag stays exactly as it is, and it
 * reappears the moment the business type has the capability again. Only the
 * value handed to a screen or to the agent changes, and it becomes `{}` — an
 * honest "this business type has no attributes", never an invented default.
 *
 * `unit` and `cost_price` are NOT gated this way: they are commercial facts
 * every business type owns.
 */
export function readableProductAttributes(
  businessType: unknown,
  stored: unknown,
): ProductAttributes {
  if (!hasCapability(businessType, "fabric_attributes")) return {};
  return storedProductAttributes(stored);
}
