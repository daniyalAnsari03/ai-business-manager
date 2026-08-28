import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import { EXPENSE_CATEGORIES, isExpenseCategory } from "@/lib/expenses/types";
import {
  createExpense,
  deleteExpense,
  getExpenses,
  getExpenseStats,
  updateExpense,
} from "@/lib/expenses/service";
import {
  findById,
  limitSchema,
  optionalText,
  orKeep,
  resolveExpense,
  toolClarify,
  toolFail,
  toolNeedsConfirmation,
  toolOk,
} from "@/lib/ai/tools/shared";
import type { Expense } from "@/lib/expenses/types";

/**
 * Expense tools — controlled wrappers over the expense service. Categories
 * are constrained to the app's fixed set so records stay reportable.
 */

function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function expenseSummary(expense: Expense) {
  return {
    id: expense.id,
    title: expense.title,
    amount: expense.amount,
    category: expense.category,
    date: expense.expenseDate,
    notes: expense.notes,
  };
}

async function loadExpenses(): Promise<Expense[] | null> {
  const result = await getExpenses();
  return result.ok ? result.data : null;
}

/**
 * Resolves an expense from either an explicit ID (preferred — bypasses the
 * ambiguous title search) or a title query. The ID path lets the agent act on
 * the exact candidate it listed earlier (e.g. "pehla wala").
 */
async function resolveExpenseTarget(
  expenses: Expense[],
  params: { expenseId?: string | null; query?: string },
): Promise<ReturnType<typeof resolveExpense>> {
  if (params.expenseId) {
    const byId = findById(expenses, params.expenseId);
    return byId ? { kind: "found", item: byId } : { kind: "not_found" };
  }
  return resolveExpense(params.query ?? "", expenses);
}

export const listExpensesTool = tool({
  name: "list_expenses",
  description:
    "List recorded expenses (newest first) with amount, category and date. Optional search matches title or notes.",
  parameters: z.object({
    search: z.string().trim().max(120).optional().nullable(),
    limit: limitSchema(15, 50),
  }),
  execute: async ({ search, limit }) => {
    const result = await getExpenses(search ? { search } : {});
    if (!result.ok) {
      return toolFail(result.reason, "Could not read expenses. Ask the user to try again.");
    }
    const expenses = result.data;
    return toolOk({
      count: expenses.length,
      truncated: expenses.length > limit,
      expenses: expenses.slice(0, limit).map((expense) => ({
        title: expense.title,
        amount: expense.amount,
        category: expense.category,
        date: expense.expenseDate,
      })),
    });
  },
});

export const createExpenseTool = tool({
  name: "create_expense",
  description:
    "Record a business expense. Requires a title, a positive amount and a category (rent/utilities/salaries/marketing/supplies/transport/other). Date defaults to today when not given. Never invent amounts.",
  parameters: z.object({
    title: z.string().trim().min(1).max(120),
    amount: z.number().positive(),
    category: z.enum(EXPENSE_CATEGORIES),
    expenseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  }),
  execute: async ({ title, amount, category, expenseDate, notes }) => {
    const result = await createExpense({
      title,
      amount,
      category,
      expenseDate: expenseDate ?? todayIsoDate(),
      notes: notes ?? null,
    });
    if (!result.ok) {
      return toolFail(
        result.reason,
        result.reason === "invalid_input"
          ? "Invalid expense details. Correct them and retry."
          : "Could not record the expense. Do not claim success.",
      );
    }
    return toolOk({
      created: true,
      expense: {
        title: result.data.title,
        amount: result.data.amount,
        category: result.data.category,
        date: result.data.expenseDate,
      },
    });
  },
});

export const updateExpenseTool = tool({
  name: "update_expense",
  description:
    "Update an existing expense's title, amount, category, date or notes. Only include the fields that should change; everything else stays as it is. Never invent amounts — ask when the user is unclear.",
  parameters: z.object({
    expenseTitle: z.string().trim().min(1).max(160).optional().nullable(),
    expenseId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact expense ID from a previous tool result when the user picked a specific candidate. Bypasses title search."),
    title: z.string().trim().min(1).max(120).optional().nullable(),
    amount: z.number().positive().optional().nullable(),
    category: z.enum(EXPENSE_CATEGORIES).optional().nullable(),
    expenseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .nullable(),
    notes: optionalText(500),
  }),
  execute: async ({ expenseTitle, expenseId, ...changes }) => {
    const expenses = await loadExpenses();
    if (!expenses) {
      return toolFail("database_error", "Could not read expenses. Ask the user to try again.");
    }
    const match = await resolveExpenseTarget(expenses, { expenseId, query: expenseTitle ?? undefined });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such expense. Tell the user honestly.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(expenseSummary),
        hint: "Several expenses match. Ask the user which one they mean.",
      });
    }

    // Merge onto the stored record so unspecified fields are preserved.
    const current = match.item;
    const merged = {
      title: changes.title ?? current.title,
      amount: changes.amount ?? current.amount,
      category:
        changes.category && isExpenseCategory(changes.category)
          ? changes.category
          : current.category,
      expenseDate: changes.expenseDate ?? current.expenseDate,
      notes: orKeep(changes.notes, current.notes),
    };

    const result = await updateExpense(current.id, merged);
    if (!result.ok) {
      return toolFail(
        result.reason,
        result.reason === "invalid_input"
          ? "Invalid expense details. Correct them and retry."
          : "Expense update failed. Do not claim success.",
      );
    }
    return toolOk({ updated: true, expense: expenseSummary(result.data) });
  },
});

export const deleteExpenseTool = tool({
  name: "delete_expense",
  description:
    "Permanently remove a recorded expense. DESTRUCTIVE: requires the user's explicit confirmation in a previous turn before confirmed=true may be used. When the user picked a specific candidate from an earlier list, pass expenseId to delete exactly that one; otherwise pass the expenseTitle.",
  parameters: z.object({
    expenseTitle: z.string().trim().min(1).max(160).optional().nullable(),
    expenseId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact expense ID from a previous tool result when the user picked a specific candidate. Bypasses title search."),
    confirmed: z.boolean().default(false),
  }),
  execute: async ({ expenseTitle, expenseId, confirmed }) => {
    const expenses = await loadExpenses();
    if (!expenses) {
      return toolFail("database_error", "Could not read expenses. Ask the user to try again.");
    }
    const match = await resolveExpenseTarget(expenses, { expenseId, query: expenseTitle ?? undefined });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such expense. Tell the user honestly.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(expenseSummary),
        hint: "Ask the user which expense they mean.",
      });
    }
    const target = match.item;
    if (!confirmed) {
      return toolNeedsConfirmation(
        `Delete expense "${target.title}" (${target.amount}, ${target.category}, ${target.expenseDate})`,
        `Kya aap sach mein kharcha "${target.title}" (${target.amount}) delete karna chahte hain?`,
        `Kya aap sach mein kharcha "${target.title}" (${target.amount}) delete karna chahte hain?`,
      );
    }
    const result = await deleteExpense(target.id);
    if (!result.ok) {
      return toolFail(result.reason, "Deletion failed. Do not claim success.");
    }
    return toolOk({ removed: true, title: target.title });
  },
});

export const expenseSummaryTool = tool({
  name: "expense_summary",
  description:
    "Real expense intelligence: today's, this week's, this month's and all-time totals; this month's expense count and per-category breakdown; the biggest single expense of this month. Answers 'is mahine ke kharche ka summary do' / 'aaj kitna kharcha hua?' / 'is month ka sabse bara expense konsa hai?'.",
  parameters: z.object({}),
  execute: async () => {
    const result = await getExpenseStats();
    if (!result.ok) {
      return toolFail(result.reason, "Could not read expenses. Ask the user to try again.");
    }
    return toolOk({ summary: result.data });
  },
});
