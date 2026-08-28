/**
 * Boundary validation for expense payloads. Pure functions only — the
 * client form uses them for instant feedback and the server service re-runs
 * them as the authoritative check. Errors are stable codes.
 */

import {
  isExpenseCategory,
  type ExpenseInput,
} from "@/lib/expenses/types";

export const EXPENSE_LIMITS = {
  titleMin: 1,
  titleMax: 120,
  notesMax: 2000,
  /** Matches numeric(12,2) in Postgres. */
  amountMax: 99_999_999_999.99,
} as const;

export type ExpenseField = "title" | "amount" | "category" | "expenseDate" | "notes";

export type ExpenseFieldError =
  | "required"
  | "too_long"
  | "not_a_number"
  | "too_small"
  | "too_large";

export type ExpenseFieldErrors = Partial<Record<ExpenseField, ExpenseFieldError>>;

export type ExpenseValidationResult =
  | { ok: true; value: ExpenseInput }
  | { ok: false; fieldErrors: ExpenseFieldErrors };

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value.trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Validates a full create/update payload. */
export function validateExpenseInput(input: unknown): ExpenseValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, fieldErrors: { title: "required" } };
  }

  const raw = input as Record<string, unknown>;
  const fieldErrors: ExpenseFieldErrors = {};

  const title =
    typeof raw.title === "string" ? raw.title.trim() : "";
  if (title.length < EXPENSE_LIMITS.titleMin) fieldErrors.title = "required";
  else if (title.length > EXPENSE_LIMITS.titleMax) fieldErrors.title = "too_long";

  const amount = parseNumeric(raw.amount);
  if (amount === null) fieldErrors.amount = "not_a_number";
  else if (amount <= 0) fieldErrors.amount = "too_small";
  else if (amount > EXPENSE_LIMITS.amountMax) fieldErrors.amount = "too_large";

  const category =
    typeof raw.category === "string" && isExpenseCategory(raw.category)
      ? raw.category
      : null;
  if (!category) fieldErrors.category = "required";

  // Date must be a real calendar day (YYYY-MM-DD from the date input).
  let expenseDate: string | null = null;
  if (typeof raw.expenseDate === "string" && raw.expenseDate.trim().length > 0) {
    const parsed = new Date(`${raw.expenseDate.trim()}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      expenseDate = raw.expenseDate.trim().slice(0, 10);
    }
  }
  if (!expenseDate) fieldErrors.expenseDate = "required";

  let notes: string | null = null;
  if (typeof raw.notes === "string" && raw.notes.trim().length > 0) {
    notes = raw.notes.trim();
    if (notes.length > EXPENSE_LIMITS.notesMax) fieldErrors.notes = "too_long";
  }

  if (
    Object.keys(fieldErrors).length > 0 ||
    !category ||
    !expenseDate ||
    amount === null
  ) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: {
      title,
      amount: Math.round(amount * 100) / 100,
      category,
      expenseDate,
      notes,
    },
  };
}
