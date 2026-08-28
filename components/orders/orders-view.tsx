"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DeleteOrderDialog } from "@/components/orders/delete-order-dialog";
import {
  OrderFormModal,
} from "@/components/orders/order-form-modal";
import {
  OrderDetailsModal,
} from "@/components/orders/order-details-modal";
import {
  OrderStatusBadge,
  statusLabelText,
} from "@/components/orders/order-status-badge";
import { OrderStatusModal } from "@/components/orders/order-status-modal";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertTriangleIcon,
  CartIcon,
  CheckCircleIcon,
  PackageIcon,
  PlusIcon,
} from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { StatCard } from "@/components/ui/stat-card";
import { EASE_PREMIUM, fadeUp, staggerContainer } from "@/components/motion/presets";
import type { Business } from "@/lib/business/types";
import { formatMoney } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/date";
import type { OrderListItem } from "@/lib/orders/service";
import type {
  Order,
  OrderStatus,
  OrderWithItems,
} from "@/lib/orders/types";
import { ORDER_STATUSES } from "@/lib/orders/types";
import type { Product } from "@/lib/products/types";
import { cn } from "@/lib/utils";

type CustomerOption = { id: string; name: string };

type OrdersViewProps = {
  business: Business;
  initialOrders: OrderListItem[];
  products: Product[];
  customers: CustomerOption[];
  loadFailed?: boolean;
};

type ActiveModal =
  | { kind: "create" }
  | { kind: "details"; order: OrderListItem }
  | { kind: "status"; order: OrderListItem }
  | { kind: "delete"; order: OrderListItem }
  | null;

type Toast = { id: number; kind: "success" | "error"; text: string };

/**
 * Orders workspace over real Supabase rows. Status changes run through an
 * atomic database function that also keeps product stock consistent — the
 * UI never invents totals or pretends a mutation succeeded.
 */
export function OrdersView({
  business,
  initialOrders,
  products,
  customers,
  loadFailed = false,
}: OrdersViewProps) {
  const { t, language } = useI18n();
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const [orders, setOrders] = useState<OrderListItem[]>(initialOrders);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [modal, setModal] = useState<ActiveModal>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const customerNameById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.name])),
    [customers],
  );

  const stats = useMemo(
    () => ({
      total: orders.length,
      pending: orders.filter((o) => o.status === "pending").length,
      completed: orders.filter((o) => o.status === "completed").length,
    }),
    [orders],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== "all" && order.status !== statusFilter) return false;
      if (!term) return true;
      return [
        order.orderNumber.toLowerCase(),
        order.customerName?.toLowerCase() ?? "",
        ...order.items.map((item) => item.productName.toLowerCase()),
      ]
        .join(" ")
        .includes(term);
    });
  }, [orders, query, statusFilter]);

  function showToast(kind: Toast["kind"], text: string) {
    setToast({ id: Date.now(), kind, text });
  }

  function handleCreated(created: OrderWithItems) {
    const listItem: OrderListItem = {
      ...created,
      customerName: created.customerId
        ? customerNameById.get(created.customerId) ?? null
        : null,
    };
    setOrders((current) => [listItem, ...current]);
    setModal(null);
    showToast(
      "success",
      t.orders.toasts.created.replace("{number}", created.orderNumber),
    );
  }

  function handleStatusSaved(updated: Order) {
    setOrders((current) =>
      current.map((order) =>
        order.id === updated.id ? { ...order, ...updated } : order,
      ),
    );
    setModal(null);
    showToast(
      "success",
      t.orders.toasts.statusUpdated.replace("{number}", updated.orderNumber),
    );
  }

  function handleDeleted(id: string) {
    const deleted = orders.find((order) => order.id === id);
    setOrders((current) => current.filter((order) => order.id !== id));
    setModal(null);
    showToast(
      "success",
      t.orders.toasts.deleted.replace("{number}", deleted?.orderNumber ?? ""),
    );
  }

  const hasProducts = products.length > 0;
  const hasOrders = orders.length > 0;
  const isSearching = query.trim().length > 0 || statusFilter !== "all";

  if (loadFailed) {
    return (
      <Card lift={false} className="relative overflow-hidden">
        <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
        <div className="relative flex flex-col items-center py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground">
            <AlertTriangleIcon className="size-6" />
          </span>
          <h2 className="mt-5 font-display text-2xl font-light">
            {t.orders.loadError}
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

  if (!hasProducts && !hasOrders) {
    /* An order needs at least one product — honest prerequisite state. */
    return (
      <div className="space-y-6">
        <OrdersHeader />
        <Card lift={false} className="relative overflow-hidden">
          <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
          <div className="relative flex flex-col items-center py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
              <PackageIcon className="size-6" />
            </span>
            <h2 className="mt-5 font-display text-2xl font-light">
              {t.orders.needProductTitle}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              {t.orders.needProductBody}
            </p>
            <Link href="/dashboard/products" className="mt-7">
              <Button size="lg">
                <PackageIcon className="size-[18px]" />
                {t.orders.goToAddProduct}
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <OrdersHeader
        action={
          hasProducts ? (
            <Button size="lg" onClick={() => setModal({ kind: "create" })}>
              <PlusIcon className="size-[18px]" />
              {t.orders.newOrderButton}
            </Button>
          ) : undefined
        }
      />

      {hasOrders ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              icon={<CartIcon className="size-4" />}
              label={t.orders.summaryTotal}
              value={stats.total.toLocaleString("en-US")}
            />
            <StatCard
              icon={<PackageIcon className="size-4" />}
              label={t.orders.summaryPending}
              value={stats.pending.toLocaleString("en-US")}
              tone={stats.pending > 0 ? "warning" : undefined}
            />
            <StatCard
              icon={<CheckCircleIcon className="size-4" />}
              label={t.orders.summaryCompleted}
              value={stats.completed.toLocaleString("en-US")}
            />
          </div>

          <div className="space-y-4">
            <SearchInput
              label={t.orders.searchLabel}
              placeholder={t.orders.searchPlaceholder}
              clearLabel={t.orders.searchClear}
              value={query}
              onChange={setQuery}
              resultText={
                isSearching
                  ? t.orders.resultsFound.replace("{count}", String(filtered.length))
                  : undefined
              }
            />

            {/* Status filter chips */}
            <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
              <FilterChip
                active={statusFilter === "all"}
                label={t.orders.filterAll}
                onClick={() => setStatusFilter("all")}
              />
              {ORDER_STATUSES.map((status) => (
                <FilterChip
                  key={status}
                  active={statusFilter === status}
                  label={statusLabelText(t)[status]}
                  onClick={() => setStatusFilter(status)}
                />
              ))}
            </div>
          </div>

          {filtered.length > 0 ? (
            reducedMotion ? (
              <OrderListBlock>
                {filtered.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    currency={business.currency}
                    language={language}
                    onOpen={(o) => setModal({ kind: "details", order: o })}
                  />
                ))}
              </OrderListBlock>
            ) : (
              <motion.div variants={staggerContainer} initial="hidden" animate="visible">
                <OrderListBlock>
                  {filtered.map((order) => (
                    <motion.div key={order.id} variants={fadeUp}>
                      <OrderRow
                        order={order}
                        currency={business.currency}
                        language={language}
                        onOpen={(o) => setModal({ kind: "details", order: o })}
                      />
                    </motion.div>
                  ))}
                </OrderListBlock>
              </motion.div>
            )
          ) : (
            <Card lift={false} className="flex flex-col items-center py-14 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
                <CartIcon className="size-5" />
              </span>
              <h2 className="mt-4 text-[15px] font-medium">
                {t.orders.noResultsTitle}
              </h2>
              <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
                {t.orders.noResultsBody}
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
              <CartIcon className="size-6" />
            </span>
            <h2 className="mt-5 font-display text-2xl font-light">
              {t.orders.emptyTitle}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              {t.orders.emptyBody}
            </p>
            {hasProducts ? (
              <Button size="lg" className="mt-7" onClick={() => setModal({ kind: "create" })}>
                <PlusIcon className="size-[18px]" />
                {t.orders.newOrderButton}
              </Button>
            ) : null}
          </div>
        </Card>
      )}

      {/* Modals — keyed so each open starts fresh */}
      {modal?.kind === "create" ? (
        <OrderFormModal
          key="create"
          products={products}
          customers={customers}
          currency={business.currency}
          onClose={() => setModal(null)}
          onCreated={handleCreated}
        />
      ) : null}
      {modal?.kind === "details" ? (
        <OrderDetailsModal
          key={`details-${modal.order.id}`}
          order={modal.order}
          customerName={modal.order.customerName}
          currency={business.currency}
          onClose={() => setModal(null)}
          onChangeStatus={() => setModal({ kind: "status", order: modal.order })}
          onDelete={() => setModal({ kind: "delete", order: modal.order })}
        />
      ) : null}
      {modal?.kind === "status" ? (
        <OrderStatusModal
          key={`status-${modal.order.id}`}
          order={modal.order}
          onClose={() => setModal(null)}
          onSaved={handleStatusSaved}
        />
      ) : null}
      {modal?.kind === "delete" ? (
        <DeleteOrderDialog
          key={`delete-${modal.order.id}`}
          order={modal.order}
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

function OrdersHeader({ action }: { action?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <PageHeader
      eyebrow={
        <>
          <CartIcon className="size-3.5" />
          {t.nav.orders}
        </>
      }
      title={t.orders.title}
      subtitle={t.orders.subtitle}
      action={action}
    />
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-9 shrink-0 snap-start whitespace-nowrap rounded-full border px-4 text-xs font-medium transition-colors",
        active
          ? "border-emerald-500/50 bg-emerald-500/[0.12] text-accent"
          : "border-line bg-surface text-muted hover:border-emerald-500/30 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function OrderListBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {children}
    </div>
  );
}

function OrderRow({
  order,
  currency,
  language,
  onOpen,
}: {
  order: OrderListItem;
  currency: Business["currency"];
  language: string;
  onOpen: (order: OrderListItem) => void;
}) {
  const { t } = useI18n();
  const itemCount =
    order.items.length > 0
      ? order.items.reduce((sum, item) => sum + item.quantity, 0)
      : 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(order)}
      className="block w-full border-b border-line text-left transition-colors last:border-b-0 hover:bg-surface-raised/60"
    >
      {/* Mobile */}
      <div className="p-4 md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium tabular-nums">
              {order.orderNumber}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted">
              {order.customerName ?? t.orders.walkIn}
            </p>
          </div>
          <div className="text-right">
            <p className="font-medium tabular-nums">
              {formatMoney(order.total, currency)}
            </p>
            <p className="mt-0.5 text-xs text-faint">
              {formatDate(order.orderedAt, language)}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <OrderStatusBadge status={order.status} />
          <span className="text-xs text-faint">
            {itemCount.toLocaleString("en-US")}
          </span>
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden items-center gap-4 px-5 py-3.5 md:flex">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium tabular-nums">
            {order.orderNumber}
          </p>
          <p className="truncate text-xs text-faint">
            {order.customerName ?? t.orders.walkIn} ·{" "}
            {formatDate(order.orderedAt, language)}
          </p>
        </div>
        <div className="w-16 shrink-0 text-right text-xs text-faint tabular-nums">
          {itemCount.toLocaleString("en-US")}
        </div>
        <div className="w-32 shrink-0 text-right text-sm font-medium tabular-nums">
          {formatMoney(order.total, currency)}
        </div>
        <div className="flex w-28 shrink-0 justify-end">
          <OrderStatusBadge status={order.status} />
        </div>
      </div>
    </button>
  );
}
