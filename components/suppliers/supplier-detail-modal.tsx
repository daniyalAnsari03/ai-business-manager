"use client";

import { useMemo, useState } from "react";
import { getSupplierBillAction } from "@/app/actions/supplier-bills";
import { useI18n } from "@/components/i18n/language-provider";
import { PaymentStatusChip } from "@/components/payments/payment-status-chip";
import { RecordPaymentModal } from "@/components/payments/record-payment-modal";
import { DeleteSupplierBillDialog } from "@/components/suppliers/delete-supplier-bill-dialog";
import { SupplierBillFormModal } from "@/components/suppliers/supplier-bill-form-modal";
import { Button } from "@/components/ui/button";
import { PencilIcon, PlusIcon, ReceiptIcon, TrashIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { RowMenu } from "@/components/ui/row-menu";
import type { CurrencyCode } from "@/lib/business/constants";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/currency";
import type { SupplierWithOwing } from "@/lib/suppliers/types";
import type { SupplierBill, SupplierBillWithDetails } from "@/lib/supplier-bills/types";

type BillSubModal =
  | { type: "add" }
  | { type: "edit"; bill: SupplierBillWithDetails }
  | { type: "pay"; bill: SupplierBillWithDetails }
  | { type: "delete"; bill: SupplierBillWithDetails }
  | null;

function isOverdue(bill: SupplierBill): boolean {
  if (bill.dueAmount <= 0 || !bill.dueDate) return false;
  const due = new Date(bill.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

/**
 * Supplier detail: the supplier's purchase bills with what is paid and due,
 * each manageable from a 3-dot menu (Pay / Edit / Delete). Money is only ever
 * moved through the shared record-payment modal.
 */
export function SupplierDetailModal({
  supplier,
  bills,
  currency,
  onClose,
  onBillSaved,
  onBillDeleted,
}: {
  supplier: SupplierWithOwing;
  bills: SupplierBillWithDetails[];
  currency: CurrencyCode;
  onClose: () => void;
  onBillSaved: (bill: SupplierBill, mode: "create" | "update") => void;
  onBillDeleted: (id: string) => void;
}) {
  const { t, language } = useI18n();
  const [sub, setSub] = useState<BillSubModal>(null);

  const owing = useMemo(
    () => bills.reduce((sum, bill) => sum + Math.max(bill.dueAmount, 0), 0),
    [bills],
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        title={supplier.name}
        description={`${t.suppliers.colOwing}: ${formatMoney(owing, currency)}`}
      >
        <div className="space-y-5">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <MetaRow
              label={t.suppliers.form.phoneLabel}
              value={supplier.phone}
            />
            <MetaRow
              label={t.suppliers.form.emailLabel}
              value={supplier.email}
            />
            <MetaRow
              label={t.suppliers.form.addressLabel}
              value={supplier.address}
            />
            <MetaRow
              label={t.suppliers.form.paymentTermsLabel}
              value={supplier.paymentTerms}
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <h3 className="text-sm font-medium">{t.supplierBills.title}</h3>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSub({ type: "add" })}
            >
              <PlusIcon className="size-4" />
              {t.supplierBills.addButton}
            </Button>
          </div>

          {bills.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-line">
              {bills.map((bill) => (
                <div
                  key={bill.id}
                  className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {bill.billNumber && bill.billNumber.trim().length > 0
                        ? bill.billNumber
                        : supplier.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatDate(bill.billDate, language)}
                      {bill.dueDate
                        ? ` · ${formatDate(bill.dueDate, language)}`
                        : ""}
                      {isOverdue(bill) ? ` · ${t.suppliers.overdueBadge}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-right text-xs tabular-nums">
                    <span className="text-muted">
                      {t.supplierBills.details.totalLabel}:{" "}
                      <span className="text-foreground">
                        {formatMoney(bill.total, currency)}
                      </span>
                    </span>
                    <span className="text-muted">
                      {t.supplierBills.details.paidLabel}:{" "}
                      <span className="text-foreground">
                        {formatMoney(bill.paidAmount, currency)}
                      </span>
                    </span>
                    <span className="text-muted">
                      {t.supplierBills.details.dueLabel}:{" "}
                      <span className="text-foreground">
                        {formatMoney(bill.dueAmount, currency)}
                      </span>
                    </span>
                  </div>
                  <PaymentStatusChip status={bill.status} />
                  <RowMenu
                    label={t.supplierBills.title}
                    items={[
                      {
                        key: "pay",
                        label: t.supplierBills.recordPaymentButton,
                        icon: <ReceiptIcon className="size-4" />,
                        disabled: bill.dueAmount <= 0,
                        onSelect: () => setSub({ type: "pay", bill }),
                      },
                      {
                        key: "edit",
                        label: t.common.edit,
                        icon: <PencilIcon className="size-4" />,
                        onSelect: () => setSub({ type: "edit", bill }),
                      },
                      {
                        key: "delete",
                        label: t.common.delete,
                        icon: <TrashIcon className="size-4" />,
                        danger: true,
                        onSelect: () => setSub({ type: "delete", bill }),
                      },
                    ]}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-line bg-surface-raised px-4 py-6 text-center text-sm text-muted">
              {t.supplierBills.emptyTitle}
            </p>
          )}
        </div>
      </Modal>

      {sub?.type === "add" ? (
        <SupplierBillFormModal
          key="bill-add"
          suppliers={[{ id: supplier.id, name: supplier.name }]}
          defaultSupplierId={supplier.id}
          currency={currency}
          onClose={() => setSub(null)}
          onSaved={(bill) => {
            setSub(null);
            onBillSaved(bill, "create");
          }}
        />
      ) : null}

      {sub?.type === "edit" ? (
        <SupplierBillFormModal
          key={`bill-edit-${sub.bill.id}`}
          suppliers={[{ id: supplier.id, name: supplier.name }]}
          defaultSupplierId={supplier.id}
          bill={sub.bill}
          currency={currency}
          onClose={() => setSub(null)}
          onSaved={(bill) => {
            setSub(null);
            onBillSaved(bill, "update");
          }}
        />
      ) : null}

      {sub?.type === "pay" ? (
        <RecordPaymentModal
          key={`bill-pay-${sub.bill.id}`}
          currency={currency}
          target={{
            kind: "bill",
            id: sub.bill.id,
            label:
              sub.bill.billNumber && sub.bill.billNumber.trim().length > 0
                ? sub.bill.billNumber
                : supplier.name,
            total: sub.bill.total,
            paid: sub.bill.paidAmount,
            due: sub.bill.dueAmount,
          }}
          onClose={() => setSub(null)}
          onRecorded={async () => {
            const refreshed = await getSupplierBillAction(sub.bill.id);
            setSub(null);
            if (refreshed.ok) {
              onBillSaved(refreshed.bill, "update");
            }
          }}
        />
      ) : null}

      {sub?.type === "delete" ? (
        <DeleteSupplierBillDialog
          key={`bill-delete-${sub.bill.id}`}
          bill={sub.bill}
          onClose={() => setSub(null)}
          onDeleted={(id) => {
            setSub(null);
            onBillDeleted(id);
          }}
        />
      ) : null}
    </>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  const display = value && value.trim().length > 0 ? value : "—";
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-surface-raised px-4 py-3">
      <span className="text-xs uppercase tracking-widest text-faint">
        {label}
      </span>
      <span className="truncate text-right text-foreground">{display}</span>
    </div>
  );
}
