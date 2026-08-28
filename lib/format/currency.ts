import { getCurrency, type CurrencyCode } from "@/lib/business/constants";

/**
 * Single source of money formatting for the whole app. Uses the business's
 * saved currency — never hardcodes one. Amounts are shown with decimals only
 * when they actually have them ("Rs 1,500" / "$12.50").
 */
export function formatMoney(amount: number, currencyCode: CurrencyCode): string {
  const currency = getCurrency(currencyCode);
  const symbol = currency?.symbol ?? currencyCode;

  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  const formattedAmount = amount.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  return `${symbol} ${formattedAmount}`;
}

/** Formats a quantity as "50 pcs" style stock text. */
export function formatStockQuantity(quantity: number, unit: string): string {
  return `${quantity.toLocaleString("en-US")} ${unit}`;
}
