"use server";

import {
  createExpense,
  deleteExpense,
  getExpenses,
  updateExpense,
  type ExpenseServiceError,
} from "@/lib/expenses/service";
import type { Expense } from "@/lib/expenses/types";

export type ExpenseActionState =
  | { ok: true; expense: Expense }
  | { ok: false; reason: ExpenseServiceError };

/**
 * Thin server-action boundary over the expense service. Inputs stay
 * `unknown` on purpose — validation and ownership happen inside the
 * service, never in the browser.
 */

export async function createExpenseAction(
  input: unknown,
): Promise<ExpenseActionState> {
  const result = await createExpense(input);
  return result.ok
    ? { ok: true, expense: result.data }
    : { ok: false, reason: result.reason };
}

export async function updateExpenseAction(
  expenseId: string,
  input: unknown,
): Promise<ExpenseActionState> {
  const result = await updateExpense(expenseId, input);
  return result.ok
    ? { ok: true, expense: result.data }
    : { ok: false, reason: result.reason };
}

export async function deleteExpenseAction(
  expenseId: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: ExpenseServiceError }> {
  const result = await deleteExpense(expenseId);
  return result.ok
    ? { ok: true, id: result.data.id }
    : { ok: false, reason: result.reason };
}

export async function getExpensesAction(
  options: Parameters<typeof getExpenses>[0] = {},
): Promise<
  | { ok: true; expenses: Expense[] }
  | { ok: false; reason: ExpenseServiceError }
> {
  const result = await getExpenses(options);
  return result.ok
    ? { ok: true, expenses: result.data }
    : { ok: false, reason: result.reason };
}
