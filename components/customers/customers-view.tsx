"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  CustomerFormModal,
} from "@/components/customers/customer-form-modal";
import { DeleteCustomerDialog } from "@/components/customers/delete-customer-dialog";
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
  UsersIcon,
} from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { StatCard } from "@/components/ui/stat-card";
import { EASE_PREMIUM, fadeUp, staggerContainer } from "@/components/motion/presets";
import type { Business } from "@/lib/business/types";
import type { Customer, CustomerWithStats } from "@/lib/customers/types";
import { formatMoney } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/date";
import { cn } from "@/lib/utils";

type CustomersViewProps = {
  business: Business;
  initialCustomers: CustomerWithStats[];
  /** True when the initial server-side fetch failed — show an honest error. */
  loadFailed?: boolean;
};

type ActiveModal =
  | { kind: "add" }
  | { kind: "edit"; customer: CustomerWithStats }
  | { kind: "details"; customer: CustomerWithStats }
  | { kind: "delete"; customer: CustomerWithStats }
  | null;

type Toast = { id: number; kind: "success" | "error"; text: string };

/**
 * Customers workspace backed by real Supabase rows. Mutations go through
 * server actions; local state updates only after confirmed success.
 */
export function CustomersView({
  business,
  initialCustomers,
  loadFailed = false,
}: CustomersViewProps) {
  const { t, language } = useI18n();
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const [customers, setCustomers] =
    useState<CustomerWithStats[]>(initialCustomers);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ActiveModal>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter((customer) =>
      [customer.name, customer.phone ?? "", customer.email ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [customers, query]);

  function showToast(kind: Toast["kind"], text: string) {
    setToast({ id: Date.now(), kind, text });
  }

  function handleSaved(customer: Customer, mode: "create" | "update") {
    setCustomers((current) => {
      if (mode === "create") {
        return [{ ...customer, totalOrders: 0, totalSpent: 0 }, ...current];
      }
      return current.map((item) =>
        item.id === customer.id ? { ...item, ...customer } : item,
      );
    });
    setModal(null);
    showToast(
      "success",
      mode === "create"
        ? t.customers.toasts.created.replace("{name}", customer.name)
        : t.customers.toasts.updated.replace("{name}", customer.name),
    );
  }

  function handleDeleted(id: string) {
    const deletedName = modal?.kind === "delete" ? modal.customer.name : "";
    setCustomers((current) => current.filter((item) => item.id !== id));
    setModal(null);
    showToast(
      "success",
      t.customers.toasts.deleted.replace("{name}", deletedName),
    );
  }

  const hasCustomers = customers.length > 0;

  if (loadFailed) {
    return (
      <Card lift={false} className="relative overflow-hidden">
        <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
        <div className="relative flex flex-col items-center py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground">
            <AlertTriangleIcon className="size-6" />
          </span>
          <h2 className="mt-5 font-display text-2xl font-light">
            {t.customers.loadError}
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
            <UsersIcon className="size-3.5" />
            {t.nav.customers}
          </>
        }
        title={t.customers.title}
        subtitle={t.customers.subtitle}
        action={
          hasCustomers ? (
            <Button size="lg" onClick={() => setModal({ kind: "add" })}>
              <PlusIcon className="size-[18px]" />
              {t.customers.addButton}
            </Button>
          ) : undefined
        }
      />

      {hasCustomers ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              icon={<UsersIcon className="size-4" />}
              label={t.customers.summaryTotal}
              value={customers.length.toLocaleString("en-US")}
            />
          </div>

          <SearchInput
            label={t.customers.searchLabel}
            placeholder={t.customers.searchPlaceholder}
            clearLabel={t.customers.searchClear}
            value={query}
            onChange={setQuery}
            resultText={t.customers.resultsFound.replace(
              "{count}",
              String(filtered.length),
            )}
          />

          {filtered.length > 0 ? (
            <ListBlock reducedMotion={Boolean(reducedMotion)}>
              {filtered.map((customer) => (
                <CustomerRow
                  key={customer.id}
                  customer={customer}
                  currency={business.currency}
                  language={language}
                  onDetails={(c) => setModal({ kind: "details", customer: c })}
                  onEdit={(c) => setModal({ kind: "edit", customer: c })}
                  onDelete={(c) => setModal({ kind: "delete", customer: c })}
                />
              ))}
            </ListBlock>
          ) : (
            <Card lift={false} className="flex flex-col items-center py-14 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
                <UsersIcon className="size-5" />
              </span>
              <h2 className="mt-4 text-[15px] font-medium">
                {t.customers.noResultsTitle}
              </h2>
              <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
                {t.customers.noResultsBody}
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
              <UsersIcon className="size-6" />
            </span>
            <h2 className="mt-5 font-display text-2xl font-light">
              {t.customers.emptyTitle}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              {t.customers.emptyBody}
            </p>
            <Button size="lg" className="mt-7" onClick={() => setModal({ kind: "add" })}>
              <PlusIcon className="size-[18px]" />
              {t.customers.addButton}
            </Button>
          </div>
        </Card>
      )}

      {/* Modals — keyed so each open starts fresh */}
      {modal?.kind === "add" ? (
        <CustomerFormModal
          key="add"
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}
      {modal?.kind === "edit" ? (
        <CustomerFormModal
          key={`edit-${modal.customer.id}`}
          customer={modal.customer}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}
      {modal?.kind === "details" ? (
        <CustomerDetailsModal
          key={`details-${modal.customer.id}`}
          customer={modal.customer}
          currency={business.currency}
          language={language}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === "delete" ? (
        <DeleteCustomerDialog
          key={`delete-${modal.customer.id}`}
          customer={modal.customer}
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

function ListBlock({
  children,
  reducedMotion,
}: {
  children: React.ReactNode;
  reducedMotion: boolean;
}) {
  return reducedMotion ? (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {children}
    </div>
  ) : (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
    >
      {children}
    </motion.div>
  );
}

function CustomerRow({
  customer,
  currency,
  language,
  onDetails,
  onEdit,
  onDelete,
}: {
  customer: CustomerWithStats;
  currency: Business["currency"];
  language: string;
  onDetails: (customer: CustomerWithStats) => void;
  onEdit: (customer: CustomerWithStats) => void;
  onDelete: (customer: CustomerWithStats) => void;
}) {
  const { t } = useI18n();

  return (
    <motion.div variants={fadeUp}>
      {/* Mobile card */}
      <div className="border-b border-line p-4 last:border-b-0 md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium">{customer.name}</p>
            <p className="mt-0.5 truncate text-xs text-muted">
              {customer.phone ?? customer.email ?? t.customers.notRecorded}
            </p>
          </div>
          <RowActions
            customer={customer}
            onDetails={onDetails}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <span>
            {t.customers.colOrders}:{" "}
            <span className="font-medium text-foreground">
              {customer.totalOrders.toLocaleString("en-US")}
            </span>
          </span>
          <span>
            {t.customers.colSpent}:{" "}
            <span className="font-medium text-foreground">
              {formatMoney(customer.totalSpent, currency)}
            </span>
          </span>
          <span>{formatDate(customer.createdAt, language)}</span>
        </div>
      </div>

      {/* Desktop row */}
      <div className="hidden items-center gap-4 border-b border-line px-5 py-3.5 transition-colors hover:bg-surface-raised/60 last:border-b-0 md:flex">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onDetails(customer)}
            className="truncate text-left text-[15px] font-medium transition-colors hover:text-accent"
          >
            {customer.name}
          </button>
          {customer.email ? (
            <p className="truncate text-xs text-faint">{customer.email}</p>
          ) : null}
        </div>
        <div className="w-36 shrink-0 truncate text-sm text-muted">
          {customer.phone ?? t.customers.notRecorded}
        </div>
        <div className="w-20 shrink-0 text-right text-sm tabular-nums">
          {customer.totalOrders.toLocaleString("en-US")}
        </div>
        <div className="w-28 shrink-0 text-right text-sm font-medium tabular-nums">
          {formatMoney(customer.totalSpent, currency)}
        </div>
        <div className="w-24 shrink-0 text-right text-xs text-faint">
          {formatDate(customer.createdAt, language)}
        </div>
        <div className="flex w-[7.5rem] shrink-0 justify-end">
          <RowActions
            customer={customer}
            onDetails={onDetails}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      </div>
    </motion.div>
  );
}

function RowActions({
  customer,
  onDetails,
  onEdit,
  onDelete,
}: {
  customer: CustomerWithStats;
  onDetails: (customer: CustomerWithStats) => void;
  onEdit: (customer: CustomerWithStats) => void;
  onDelete: (customer: CustomerWithStats) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconAction label={t.common.view} onClick={() => onDetails(customer)}>
        <EyeIcon className="size-4" />
      </IconAction>
      <IconAction label={t.common.edit} onClick={() => onEdit(customer)}>
        <PencilIcon className="size-4" />
      </IconAction>
      <IconAction
        label={t.common.delete}
        danger
        onClick={() => onDelete(customer)}
      >
        <TrashIcon className="size-4" />
      </IconAction>
    </div>
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

function CustomerDetailsModal({
  customer,
  currency,
  language,
  onClose,
}: {
  customer: CustomerWithStats;
  currency: Business["currency"];
  language: string;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <Modal
      open
      onClose={onClose}
      title={t.customers.detailsTitle}
      description={customer.name}
    >
      <div className="space-y-4 text-sm">
        <DetailRow label={t.customers.form.phoneLabel} value={customer.phone} />
        <DetailRow label={t.customers.form.emailLabel} value={customer.email} />
        <DetailRow label={t.customers.detailsAddressLabel} value={customer.address} />
        <DetailRow label={t.customers.detailsNotesLabel} value={customer.notes} />
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="rounded-xl border border-line bg-surface-raised px-4 py-3">
            <p className="text-xs uppercase tracking-widest text-faint">
              {t.customers.colOrders}
            </p>
            <p className="mt-1 font-display text-xl font-light">
              {customer.totalOrders.toLocaleString("en-US")}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface-raised px-4 py-3">
            <p className="text-xs uppercase tracking-widest text-faint">
              {t.customers.colSpent}
            </p>
            <p className="mt-1 font-display text-xl font-light">
              {formatMoney(customer.totalSpent, currency)}
            </p>
          </div>
        </div>
        <p className="text-xs text-faint">
          {t.customers.colAdded}: {formatDate(customer.createdAt, language)}
        </p>
      </div>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  const display = value && value.trim().length > 0 ? value : null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right font-medium">{display ?? "—"}</dd>
    </div>
  );
}
