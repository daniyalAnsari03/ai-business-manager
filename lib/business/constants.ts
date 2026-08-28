/** Business type codes stored in the database. */
export const BUSINESS_TYPES = [
  "clothing_fashion",
  "restaurant_food",
  "retail_shop",
  "grocery",
  "electronics",
  "services",
  "other",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export function isBusinessType(value: string): value is BusinessType {
  return (BUSINESS_TYPES as readonly string[]).includes(value);
}

/** Currencies offered during setup (ISO 4217). PKR first for the primary market. */
export const CURRENCIES = [
  { code: "PKR", symbol: "Rs", label: "Pakistani Rupee" },
  { code: "USD", symbol: "$", label: "US Dollar" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "GBP", symbol: "£", label: "British Pound" },
  { code: "AED", symbol: "د.إ", label: "UAE Dirham" },
  { code: "SAR", symbol: "﷼", label: "Saudi Riyal" },
  { code: "INR", symbol: "₹", label: "Indian Rupee" },
  { code: "BDT", symbol: "৳", label: "Bangladeshi Taka" },
  { code: "TRY", symbol: "₺", label: "Turkish Lira" },
  { code: "MYR", symbol: "RM", label: "Malaysian Ringgit" },
  { code: "CAD", symbol: "C$", label: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", label: "Australian Dollar" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

const CURRENCY_CODES = new Set<string>(CURRENCIES.map((c) => c.code));

export function isCurrencyCode(value: string): value is CurrencyCode {
  return CURRENCY_CODES.has(value);
}

export function getCurrency(code: string) {
  return CURRENCIES.find((currency) => currency.code === code);
}
