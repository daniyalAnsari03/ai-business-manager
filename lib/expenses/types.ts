/** Expense domain types shared by the service layer, server actions and UI. */

export const EXPENSE_CATEGORIES = [
  "rent",
  "utilities",
  "salaries",
  "marketing",
  "supplies",
  "transport",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

export interface Expense {
  id: string;
  businessId: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  /** Calendar day of the expense (YYYY-MM-DD). */
  expenseDate: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseInput {
  title: string;
  amount: number;
  category: ExpenseCategory;
  expenseDate: string;
  notes: string | null;
}
