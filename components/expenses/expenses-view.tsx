"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ExpenseFormModal,
} from "@/components/expenses/expense-form-modal";
import { DeleteExpenseDialog } from "@/components/expenses/delete-expense-dialog";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  EyeIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  TrendingUpIcon,
  WalletIcon,
} from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { StatCard } from "@/components/ui/stat-card";
import { EASE_PREMIUM, fadeUp, staggerContainer } from "@/components/motion/presets";
import type { CurrencyCode } from "@/lib/business/constants";
import type { Expense } from "@/lib/expenses/types";
import { formatMoney } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/date";
import { cn } from "@/lib/utils";

type ExpensesViewProps = {
  currency: CurrencyCode;
  initialExpenses: Expense[];
  /** True when the initial server-side fetch failed — show an honest error. */
  loadFailed?: boolean;
};

type ActiveModal =
  | { kind: "add" }
  | { kind: "edit"; expense: Expense }
  | { kind: "details"; expense: Expense }
  | { kind: "delete"; expense: Expense }
  | null;

type Toast = { id: number; kind: "success" | "error"; text: string };

/**
 * Expenses workspace over real Supabase rows. Totals are recomputed from
 * the live list after every confirmed mutation — never guessed.
 */
export function ExpensesView({
  currency,
  initialExpenses,
  loadFailed = false,
}: ExpensesViewProps) {
  const { t, language } = useI18n();
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ActiveModal>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const totals = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    let monthTotal = 0;
    let allTimeTotal = 0;
    for (const expense of expenses) {
      allTimeTotal += expense.amount;
      if (new Date(`${expense.expenseDate}T00:00:00`).getTime() >= monthStart.getTime()) {
        monthTotal += expense.amount;
      }
    }
    return { monthTotal, allTimeTotal };
  }, [expenses]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return expenses;
    return expenses.filter((expense) =>
      [expense.title, expense.notes ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [expenses, query]);

  function showToast(kind: Toast["kind"], text: string) {
    setToast({ id: Date.now(), kind, text });
  }

  function handleSaved(expense: Expense, mode: "create" | "update") {
    setExpenses((current) => {
      if (mode === "create") return [expense, ...current];
      return current
        .map((item) => (item.id === expense.id ? expense : item))
        .sort(compareExpenses);
    });
    setModal(null);
    showToast(
      "success",
      mode === "create" ? t.expenses.toasts.created : t.expenses.toasts.updated,
    );
  }

  function handleDeleted(id: string) {
    setExpenses((current) => current.filter((item) => item.id !== id));
    setModal(null);
    showToast("success", t.expenses.toasts.deleted);
  }

  const hasExpenses = expenses.length > 0;

  if (loadFailed) {
    return (
      <Card lift={false} className="relative overflow-hidden">
        <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
        <div className="relative flex flex-col items-center py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground">
            <AlertTriangleIcon className="size-6" />
          </span>
          <h2 className="mt-5 font-display text-2xl font-light">
            {t.expenses.loadError}
          </h2>
          <Button
            variant="secondary"
            size="lg"
            className="mt-7"
            onClick={() => router.refresh()}
          >
            {t.common.tryAgain}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <WalletIcon className="size-3.5" />
            {t.nav.expenses}
          </>
        }
        title={t.expenses.title}
        subtitle={t.expenses.subtitle}
        action={
          hasExpenses ? (
            <Button size="lg" onClick={() => setModal({ kind: "add" })}>
              <PlusIcon className="size-[18px]" />
              {t.expenses.addButton}
            </Button>
          ) : undefined
        }
      />

      {hasExpenses ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              icon={<WalletIcon className="size-4" />}
              label={t.expenses.summaryMonth}
              value={formatMoney(totals.monthTotal, currency)}
            />
            <StatCard
              icon={<TrendingUpIcon className="size-4" />}
              label={t.expenses.summaryAllTime}
              value={formatMoney(totals.allTimeTotal, currency)}
            />
          </div>

          <SearchInput
            label={t.expenses.searchLabel}
            placeholder={t.expenses.searchPlaceholder}
            clearLabel={t.expenses.searchClear}
            value={query}
            onChange={setQuery}
            resultText={
              query.trim()
                ? t.expenses.resultsFound.replace("{count}", String(filtered.length))
                : undefined
            }
          />

          {filtered.length > 0 ? (
            reducedMotion ? (
              <ExpensesListBlock>
                {filtered.map((expense) => (
                  <ExpenseRow
                    key={expense.id}
                    expense={expense}
                    currency={currency}
                    language={language}
                    onDetails={(e) => setModal({ kind: "details", expense: e })}
                    onEdit={(e) => setModal({ kind: "edit", expense: e })}
                    onDelete={(e) => setModal({ kind: "delete", expense: e })}
                  />
                ))}
              </ExpensesListBlock>
            ) : (
              <motion.div variants={staggerContainer} initial="hidden" animate="visible">
                <ExpensesListBlock>
                  {filtered.map((expense) => (
                    <motion.div key={expense.id} variants={fadeUp}>
                      <ExpenseRow
                        expense={expense}
                        currency={currency}
                        language={language}
                        onDetails={(e) => setModal({ kind: "details", expense: e })}
                        onEdit={(e) => setModal({ kind: "edit", expense: e })}
                        onDelete={(e) => setModal({ kind: "delete", expense: e })}
                      />
                    </motion.div>
                  ))}
                </ExpensesListBlock>
              </motion.div>
            )
          ) : (
            <Card lift={false} className="flex flex-col items-center py-14 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
                <WalletIcon className="size-5" />
              </span>
              <h2 className="mt-4 text-[15px] font-medium">
                {t.expenses.noResultsTitle}
              </h2>
              <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
                {t.expenses.noResultsBody}
              </p>
            </Card>
          )}
        </>
      ) : (
        /* Honest empty state */
        <Card lift={false} className="relative overflow-hidden">
          <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
          <div className="relative flex flex-col items-center py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
              <WalletIcon className="size-6" />
            </span>
            <h2 className="mt-5 font-display text-2xl font-light">
              {t.expenses.emptyTitle}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              {t.expenses.emptyBody}
            </p>
            <Button size="lg" className="mt-7" onClick={() => setModal({ kind: "add" })}>
              <PlusIcon className="size-[18px]" />
              {t.expenses.addButton}
            </Button>
          </div>
        </Card>
      )}

      {/* Modals — keyed so each open starts fresh */}
      {modal?.kind === "add" ? (
        <ExpenseFormModal
          key="add"
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}
      {modal?.kind === "edit" ? (
        <ExpenseFormModal
          key={`edit-${modal.expense.id}`}
          expense={modal.expense}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}
      {modal?.kind === "details" ? (
        <ExpenseDetailsModal
          key={`details-${modal.expense.id}`}
          expense={modal.expense}
          currency={currency}
          language={language}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === "delete" ? (
        <DeleteExpenseDialog
          key={`delete-${modal.expense.id}`}
          expense={modal.expense}
          onClose={() => setModal(null)}
          onDeleted={handleDeleted}
        />
      ) : null}

      {/* Feedback */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4"
      >
        <AnimatePresence>
          {toast ? (
            <motion.div
              key={toast.id}
              initial={reducedMotion ? false : { opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.3, ease: EASE_PREMIUM }}
              className={cn(
                "pointer-events-auto flex items-center gap-2.5 rounded-full border px-5 py-3 text-sm font-medium shadow-phone backdrop-blur-xl",
                toast.kind === "success"
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "border-line bg-surface-raised text-foreground",
              )}
            >
              {toast.kind === "success" ? (
                <CheckCircleIcon className="size-4 shrink-0" />
              ) : (
                <AlertTriangleIcon className="size-4 shrink-0" />
              )}
              {toast.text}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function compareExpenses(a: Expense, b: Expense): number {
  if (a.expenseDate !== b.expenseDate) {
    return a.expenseDate < b.expenseDate ? 1 : -1;
  }
  return a.createdAt < b.createdAt ? 1 : -1;
}

function ExpensesListBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {children}
    </div>
  );
}

function ExpenseRow({
  expense,
  currency,
  language,
  onDetails,
  onEdit,
  onDelete,
}: {
  expense: Expense;
  currency: CurrencyCode;
  language: string;
  onDetails: (expense: Expense) => void;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}) {
  const { t } = useI18n();

  return (
    <div>
      {/* Mobile card */}
      <div className="border-b border-line p-4 last:border-b-0 md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium">{expense.title}</p>
            <p className="mt-0.5 truncate text-xs text-muted">
              {t.expenses.categories[expense.category]} ·{" "}
              {formatDate(expense.expenseDate, language)}
            </p>
          </div>
          <span className="shrink-0 font-medium tabular-nums">
            −{formatMoney(expense.amount, currency)}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-1">
          <RowActions
            expense={expense}
            onDetails={onDetails}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      </div>

      {/* Desktop row */}
      <div className="hidden items-center gap-4 border-b border-line px-5 py-3.5 transition-colors last:border-b-0 hover:bg-surface-raised/60 md:flex">
        <button
          type="button"
          onClick={() => onDetails(expense)}
          className="min-w-0 flex-1 truncate text-left text-[15px] font-medium transition-colors hover:text-accent"
        >
          {expense.title}
        </button>
        <div className="w-40 shrink-0 truncate text-sm text-muted">
          {t.expenses.categories[expense.category]}
        </div>
        <div className="w-28 shrink-0 text-right text-xs text-faint">
          {formatDate(expense.expenseDate, language)}
        </div>
        <div className="w-32 shrink-0 text-right font-medium tabular-nums">
          −{formatMoney(expense.amount, currency)}
        </div>
        <div className="flex w-[7.5rem] shrink-0 justify-end">
          <RowActions
            expense={expense}
            onDetails={onDetails}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  );
}

function RowActions({
  expense,
  onDetails,
  onEdit,
  onDelete,
}: {
  expense: Expense;
  onDetails: (expense: Expense) => void;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}) {
  const { t } = useI18n();

  return (
    <>
      <IconAction label={t.common.view} onClick={() => onDetails(expense)}>
        <EyeIcon className="size-4" />
      </IconAction>
      <IconAction label={t.common.edit} onClick={() => onEdit(expense)}>
        <PencilIcon className="size-4" />
      </IconAction>
      <IconAction
        label={t.common.delete}
        danger
        onClick={() => onDelete(expense)}
      >
        <TrashIcon className="size-4" />
      </IconAction>
    </>
  );
}

function IconAction({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-raised hover:text-foreground min-touch-target",
        danger && "hover:bg-foreground/[0.08] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ExpenseDetailsModal({
  expense,
  currency,
  language,
  onClose,
}: {
  expense: Expense;
  currency: CurrencyCode;
  language: string;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <Modal
      open
      onClose={onClose}
      title={expense.title}
      description={`${t.expenses.categories[expense.category]} · ${formatDate(expense.expenseDate, language)}`}
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-xl border border-line bg-surface-raised px-4 py-3">
          <p className="text-xs uppercase tracking-widest text-faint">
            {t.expenses.colAmount}
          </p>
          <p className="mt-1 font-display text-2xl font-light tabular-nums">
            {formatMoney(expense.amount, currency)}
          </p>
        </div>
        {expense.notes ? (
          <div className="rounded-xl border border-line bg-surface-raised px-4 py-3">
            <p className="text-xs uppercase tracking-widest text-faint">
              {t.expenses.form.notesLabel}
            </p>
            <p className="mt-1 leading-relaxed">{expense.notes}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
