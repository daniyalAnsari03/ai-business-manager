import { serviceState } from "./service-state.mjs";

function findExpense(expenseId) {
  return (serviceState.expenses.data ?? []).find((e) => e.id === expenseId) ?? null;
}

// Deterministic stand-ins for the expense service functions the audited tools
// call. A success applies the incoming values onto the stored record, so the
// audit snapshot reflects exactly the fields that really changed.
export async function getExpenses() {
  return serviceState.expenses;
}

export async function createExpense(input) {
  if (serviceState.createExpenseResult) return serviceState.createExpenseResult;
  return {
    ok: true,
    data: {
      id: "expense-new",
      businessId: "biz",
      title: input.title,
      amount: input.amount,
      category: input.category,
      expenseDate: input.expenseDate,
      notes: input.notes ?? null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

export async function updateExpense(expenseId, input) {
  if (serviceState.updateExpenseResult) return serviceState.updateExpenseResult;
  const expense = findExpense(expenseId);
  if (!expense) return { ok: false, reason: "not_found" };
  return { ok: true, data: { ...expense, ...input } };
}

export async function deleteExpense(expenseId) {
  if (serviceState.deleteExpenseResult) return serviceState.deleteExpenseResult;
  const expense = findExpense(expenseId);
  if (!expense) return { ok: false, reason: "not_found" };
  return { ok: true, data: { id: expense.id } };
}

// Not used by the audited tools, but imported by the tool module.
export async function getExpenseStats() {
  return { ok: false, reason: "not_implemented_in_stub" };
}