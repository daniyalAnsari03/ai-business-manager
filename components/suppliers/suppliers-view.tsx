"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/language-provider";
import { DeleteSupplierDialog } from "@/components/suppliers/delete-supplier-dialog";
import { SupplierDetailModal } from "@/components/suppliers/supplier-detail-modal";
import { SupplierFormModal } from "@/components/suppliers/supplier-form-modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  TruckIcon,
} from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowMenu } from "@/components/ui/row-menu";
import { SearchInput } from "@/components/ui/search-input";
import { StatCard } from "@/components/ui/stat-card";
import type { Business } from "@/lib/business/types";
import { formatMoney } from "@/lib/format/currency";
import type { Supplier, SupplierWithOwing } from "@/lib/suppliers/types";
import type {
  SupplierBill,
  SupplierBillWithDetails,
} from "@/lib/supplier-bills/types";

type ActiveModal =
  | { type: "add" }
  | { type: "edit"; supplier: SupplierWithOwing }
  | { type: "delete"; supplier: SupplierWithOwing }
  | { type: "detail"; supplier: SupplierWithOwing }
  | null;

type Toast = { id: number; kind: "success" | "error"; text: string };

function daysOverdue(bill: SupplierBill): boolean {
  if (bill.dueAmount <= 0 || !bill.dueDate) return false;
  const due = new Date(bill.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

/**
 * Suppliers workspace: who supplies the stock and what is still owed, with
 * each supplier's purchase bills managed in a detail view. Owing figures are
 * derived from the loaded bills so a recorded payment updates them instantly.
 */
export function SuppliersView({
  business,
  initialSuppliers,
  initialBills,
  loadFailed = false,
}: {
  business: Business;
  initialSuppliers: SupplierWithOwing[];
  initialBills: SupplierBillWithDetails[];
  loadFailed?: boolean;
}) {
  const { t } = useI18n();
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [bills, setBills] = useState(initialBills);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ActiveModal>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (loadFailed) {
    return <LoadError />;
  }

  const owingBySupplier = new Map<string, number>();
  const overdueSuppliers = new Set<string>();
  for (const bill of bills) {
    const owing = Math.max(bill.dueAmount, 0);
    owingBySupplier.set(
      bill.supplierId,
      (owingBySupplier.get(bill.supplierId) ?? 0) + owing,
    );
    if (daysOverdue(bill)) overdueSuppliers.add(bill.supplierId);
  }
  const totalPayable = [...owingBySupplier.values()].reduce(
    (sum, value) => sum + value,
    0,
  );

  const term = query.trim().toLowerCase();
  const filtered = term
    ? suppliers.filter((supplier) =>
        [supplier.name, supplier.phone ?? "", supplier.email ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(term),
      )
    : suppliers;

  function showToast(kind: Toast["kind"], text: string) {
    setToast({ id: Date.now(), kind, text });
  }

  function handleSupplierSaved(
    supplier: Supplier,
    mode: "create" | "update",
  ) {
    setSuppliers((current) =>
      mode === "create"
        ? [{ ...supplier, totalOwing: 0 }, ...current]
        : current.map((item) =>
            item.id === supplier.id ? { ...item, ...supplier } : item,
          ),
    );
    showToast(
      "success",
      mode === "create"
        ? t.suppliers.toasts.created.replace("{name}", supplier.name)
        : t.suppliers.toasts.updated.replace("{name}", supplier.name),
    );
    setModal(null);
  }

  function handleSupplierDeleted(id: string) {
    const name = suppliers.find((s) => s.id === id)?.name ?? "";
    setSuppliers((current) => current.filter((item) => item.id !== id));
    showToast(
      "success",
      t.suppliers.toasts.deleted.replace("{name}", name),
    );
    setModal(null);
  }

  function handleBillSaved(bill: SupplierBill, mode: "create" | "update") {
    setBills((current) => {
      if (mode === "update") {
        return current.map((item) =>
          item.id === bill.id ? { ...item, ...bill } : item,
        );
      }
      const supplierName =
        suppliers.find((s) => s.id === bill.supplierId)?.name ?? "";
      return [{ ...bill, supplierName }, ...current];
    });
    showToast(
      "success",
      mode === "create"
        ? t.supplierBills.toasts.created
        : t.supplierBills.toasts.updated,
    );
  }

  function handleBillDeleted(id: string) {
    setBills((current) => current.filter((item) => item.id !== id));
    showToast("success", t.supplierBills.toasts.deleted);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <TruckIcon className="size-3.5" />
            {t.nav.suppliers}
          </>
        }
        title={t.suppliers.title}
        subtitle={t.suppliers.subtitle}
        action={
          suppliers.length > 0 ? (
            <Button size="lg" onClick={() => setModal({ type: "add" })}>
              <PlusIcon className="size-[18px]" />
              {t.suppliers.addButton}
            </Button>
          ) : undefined
        }
      />

      {suppliers.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              icon={<TruckIcon className="size-4" />}
              label={t.suppliers.colName}
              value={suppliers.length.toLocaleString("en-US")}
            />
            <StatCard
              icon={<AlertTriangleIcon className="size-4" />}
              label={t.suppliers.totalPayableLabel}
              value={formatMoney(totalPayable, business.currency)}
            />
          </div>

          <SearchInput
            label={t.suppliers.searchLabel}
            placeholder={t.suppliers.searchPlaceholder}
            clearLabel={t.suppliers.searchClear}
            value={query}
            onChange={setQuery}
          />

          {filtered.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {filtered.map((supplier) => {
                const owing = owingBySupplier.get(supplier.id) ?? 0;
                const overdue = overdueSuppliers.has(supplier.id);
                return (
                  <div
                    key={supplier.id}
                    className="flex items-center gap-4 border-b border-line px-5 py-3.5 transition-colors hover:bg-surface-raised/60 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setModal({ type: "detail", supplier })}
                        className="truncate text-left text-[15px] font-medium transition-colors hover:text-accent"
                      >
                        {supplier.name}
                      </button>
                      <p className="truncate text-xs text-muted">
                        {supplier.phone ?? supplier.email ?? "—"}
                      </p>
                    </div>
                    {overdue ? (
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
                        {t.suppliers.overdueBadge}
                      </span>
                    ) : null}
                    <div className="w-28 shrink-0 text-right text-sm font-medium tabular-nums">
                      {formatMoney(owing, business.currency)}
                    </div>
                    <RowMenu
                      label={supplier.name}
                      items={[
                        {
                          key: "edit",
                          label: t.common.edit,
                          icon: <PencilIcon className="size-4" />,
                          onSelect: () => setModal({ type: "edit", supplier }),
                        },
                        {
                          key: "delete",
                          label: t.common.delete,
                          icon: <TrashIcon className="size-4" />,
                          danger: true,
                          onSelect: () =>
                            setModal({ type: "delete", supplier }),
                        },
                      ]}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <Card lift={false} className="py-12 text-center">
              <h2 className="text-[15px] font-medium">
                {t.suppliers.noResultsTitle}
              </h2>
              <p className="mt-1.5 text-sm text-muted">
                {t.suppliers.noResultsBody}
              </p>
            </Card>
          )}
        </>
      ) : (
        <Card lift={false} className="relative overflow-hidden">
          <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
          <div className="relative flex flex-col items-center py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
              <TruckIcon className="size-6" />
            </span>
            <h2 className="mt-5 font-display text-2xl font-light">
              {t.suppliers.emptyTitle}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              {t.suppliers.emptyBody}
            </p>
            <Button
              size="lg"
              className="mt-7"
              onClick={() => setModal({ type: "add" })}
            >
              <PlusIcon className="size-[18px]" />
              {t.suppliers.addButton}
            </Button>
          </div>
        </Card>
      )}

      {modal?.type === "add" ? (
        <SupplierFormModal
          key="supplier-add"
          onClose={() => setModal(null)}
          onSaved={handleSupplierSaved}
        />
      ) : null}
      {modal?.type === "edit" ? (
        <SupplierFormModal
          key={`supplier-edit-${modal.supplier.id}`}
          supplier={modal.supplier}
          onClose={() => setModal(null)}
          onSaved={handleSupplierSaved}
        />
      ) : null}
      {modal?.type === "delete" ? (
        <DeleteSupplierDialog
          key={`supplier-delete-${modal.supplier.id}`}
          supplier={modal.supplier}
          onClose={() => setModal(null)}
          onDeleted={handleSupplierDeleted}
        />
      ) : null}
      {modal?.type === "detail" ? (
        <SupplierDetailModal
          key={`supplier-detail-${modal.supplier.id}`}
          supplier={modal.supplier}
          currency={business.currency}
          bills={bills.filter(
            (bill) => bill.supplierId === modal.supplier.id,
          )}
          onClose={() => setModal(null)}
          onBillSaved={handleBillSaved}
          onBillDeleted={handleBillDeleted}
        />
      ) : null}

      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4"
      >
        {toast ? (
          <div
            className={
              toast.kind === "success"
                ? "pointer-events-auto flex items-center gap-2.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-5 py-3 text-sm font-medium text-emerald-700 shadow-phone backdrop-blur-xl dark:text-emerald-300"
                : "pointer-events-auto flex items-center gap-2.5 rounded-full border border-line bg-surface-raised px-5 py-3 text-sm font-medium text-foreground shadow-phone backdrop-blur-xl"
            }
          >
            {toast.kind === "success" ? (
              <CheckCircleIcon className="size-4 shrink-0" />
            ) : (
              <AlertTriangleIcon className="size-4 shrink-0" />
            )}
            {toast.text}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LoadError() {
  const { t } = useI18n();
  return (
    <Card lift={false} className="relative overflow-hidden">
      <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
      <div className="relative flex flex-col items-center py-14 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground">
          <AlertTriangleIcon className="size-6" />
        </span>
        <h2 className="mt-5 font-display text-2xl font-light">
          {t.suppliers.loadError}
        </h2>
      </div>
    </Card>
  );
}
