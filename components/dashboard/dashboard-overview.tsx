"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/components/i18n/language-provider";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import {
  AlertTriangleIcon,
  ArchiveIcon,
  CartIcon,
  ChartIcon,
  CheckCircleIcon,
  PackageIcon,
  SendIcon,
  BrandMark,
  TrendingUpIcon,
  UsersIcon,
  WalletIcon,
  XCircleIcon,
} from "@/components/ui/icons";
import { getCurrency } from "@/lib/business/constants";
import type { Business } from "@/lib/business/types";
import type {
  DashboardMetrics,
  LowStockEntry,
} from "@/lib/dashboard/service";
import { formatMoney } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/date";
import { dictionaries } from "@/lib/i18n/dictionary";

/**
 * Dashboard over real business data: sales, orders, customers, expenses,
 * stock and recent activity — each fed by its module service. Nothing is
 * fabricated; unavailable sections say so honestly.
 */
export function DashboardOverview({
  business,
  metrics,
}: {
  business: Business;
  metrics: DashboardMetrics;
}) {
  const { t, language } = useI18n();
  const currency = getCurrency(business.currency)?.code ?? business.currency;
  const profileLanguageName =
    dictionaries[business.language].common.languageName;

  const memberSince = new Date(business.createdAt).toLocaleDateString(
    language === "ur" ? "en-PK" : "en-GB",
    { day: "numeric", month: "long", year: "numeric" },
  );

  const hasSales = (metrics.salesSummary?.allTime.orderCount ?? 0) > 0;
  const hasOrders =
    metrics.orderStats !== null && metrics.orderStats.total > 0;
  const hasProducts = (metrics.productStats?.totalProducts ?? 0) > 0;
  const hasCustomers = (metrics.customerCount ?? 0) > 0;
  const hasExpenses = (metrics.expenseStats?.allTimeTotal ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <PageHeader
        eyebrow={
          <>
            <CheckCircleIcon className="size-3.5" />
            {t.dashboard.setupDoneBadge}
          </>
        }
        title={
          <>
            {t.dashboard.welcome},{" "}
            <span className="text-accent">{business.name}</span>
          </>
        }
        subtitle={t.dashboard.subtitle}
      />

      {/* Live module metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          href="/dashboard/sales"
          icon={<TrendingUpIcon className="size-4" />}
          label={t.dashboard.salesTodayLabel}
        >
          {hasSales && metrics.salesSummary ? (
            <>
              <p className="font-display text-3xl font-light tabular-nums leading-tight">
                {formatMoney(metrics.salesSummary.today.revenue, currency)}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t.dashboard.salesMonthLabel}:{" "}
                {formatMoney(metrics.salesSummary.month.revenue, currency)}
              </p>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-faint">
              {t.dashboard.salesEmptyBody}
            </p>
          )}
        </MetricCard>

        <MetricCard
          href="/dashboard/orders"
          icon={<CartIcon className="size-4" />}
          label={t.dashboard.ordersCardTitle}
        >
          {hasOrders && metrics.orderStats ? (
            <>
              <p className="font-display text-3xl font-light leading-tight">
                {metrics.orderStats.total.toLocaleString("en-US")}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t.orders.summaryPending}: {metrics.orderStats.pending} ·{" "}
                {t.orders.summaryCompleted}: {metrics.orderStats.completed}
              </p>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-faint">
              {t.dashboard.ordersEmptyBody}
            </p>
          )}
        </MetricCard>

        <MetricCard
          href="/dashboard/customers"
          icon={<UsersIcon className="size-4" />}
          label={t.dashboard.customersCardTitle}
        >
          {hasCustomers ? (
            <>
              <p className="font-display text-3xl font-light leading-tight">
                {(metrics.customerCount ?? 0).toLocaleString("en-US")}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t.dashboard.customersCountLabel}
              </p>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-faint">
              {t.dashboard.customersEmptyBody}
            </p>
          )}
        </MetricCard>

        <MetricCard
          href="/dashboard/expenses"
          icon={<WalletIcon className="size-4" />}
          label={t.dashboard.expensesCardTitle}
        >
          {hasExpenses && metrics.expenseStats ? (
            <>
              <p className="font-display text-3xl font-light tabular-nums leading-tight">
                {formatMoney(metrics.expenseStats.monthTotal, currency)}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t.dashboard.expensesAllTimeLabel}:{" "}
                {formatMoney(metrics.expenseStats.allTimeTotal, currency)}
              </p>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-faint">
              {t.dashboard.expensesEmptyBody}
            </p>
          )}
        </MetricCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        {/* Recent orders */}
        <Card lift={false}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium uppercase tracking-widest text-faint">
              {t.dashboard.recentOrdersTitle}
            </h2>
            {hasOrders ? (
              <Link
                href="/dashboard/orders"
                className="inline-flex min-h-9 items-center text-xs font-medium text-accent transition-colors hover:text-accent-strong"
              >
                {t.dashboard.viewOrders}
                <span aria-hidden>→</span>
              </Link>
            ) : null}
          </div>
          {metrics.recentOrders.length > 0 ? (
            <ul className="mt-4 space-y-1">
              {metrics.recentOrders.map((order) => (
                <li
                  key={order.id}
                  className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium tabular-nums">
                      {order.orderNumber}
                    </p>
                    <p className="truncate text-xs text-faint">
                      {order.customerName ?? t.orders.walkIn} ·{" "}
                      {formatDate(order.orderedAt, language)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <OrderStatusBadge status={order.status} />
                    <span className="w-24 text-right text-sm font-medium tabular-nums">
                      {formatMoney(order.total, currency)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {t.dashboard.recentOrdersEmptyBody}
            </p>
          )}
        </Card>

        {/* Business profile */}
        <Card lift={false}>
          <h2 className="text-sm font-medium uppercase tracking-widest text-faint">
            {t.dashboard.businessDetailsTitle}
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <ProfileRow
              label={t.dashboard.businessTypeLabel}
              value={t.businessTypes[business.businessType]}
            />
            <ProfileRow
              label={t.dashboard.currencyLabel}
              value={
                getCurrency(business.currency)
                  ? `${getCurrency(business.currency)!.code} (${getCurrency(business.currency)!.symbol})`
                  : business.currency
              }
            />
            <ProfileRow
              label={t.dashboard.languageLabel}
              value={profileLanguageName}
            />
            <ProfileRow
              label={t.dashboard.memberSinceLabel}
              value={memberSince}
            />
          </dl>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Products & stock summary */}
        <Card lift={false}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-faint">
              <ArchiveIcon className="size-4" aria-hidden />
              {t.dashboard.inventoryCardTitle}
            </h2>
            {hasProducts ? (
              <Link
                href="/dashboard/inventory"
                className="inline-flex min-h-9 items-center text-xs font-medium text-accent transition-colors hover:text-accent-strong"
              >
                {t.dashboard.viewInventory}
                <span aria-hidden>→</span>
              </Link>
            ) : null}
          </div>
          {hasProducts && metrics.productStats ? (
            <dl className="mt-4 space-y-2.5 text-sm">
              <InventoryRow
                icon={<PackageIcon className="size-3.5" />}
                label={t.dashboard.inventoryTotalLabel}
                value={metrics.productStats.totalProducts}
              />
              <InventoryRow
                icon={<AlertTriangleIcon className="size-3.5" />}
                label={t.dashboard.inventoryLowLabel}
                value={metrics.productStats.lowStockCount}
                tone={
                  metrics.productStats.lowStockCount > 0 ? "warning" : undefined
                }
              />
              <InventoryRow
                icon={<XCircleIcon className="size-3.5" />}
                label={t.dashboard.inventoryOutLabel}
                value={metrics.productStats.outOfStockCount}
                tone={
                  metrics.productStats.outOfStockCount > 0 ? "danger" : undefined
                }
              />
            </dl>
          ) : (
            <>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {t.dashboard.emptyProductsBody}
              </p>
              <Link
                href="/dashboard/products"
                className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-accent transition-colors hover:text-accent-strong"
              >
                {t.products.addButton}
                <span aria-hidden>→</span>
              </Link>
            </>
          )}
        </Card>

        {/* Needs restock */}
        <Card lift={false}>
          <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-faint">
            <AlertTriangleIcon className="size-4" aria-hidden />
            {t.dashboard.lowStockCardTitle}
          </h2>
          {hasProducts && metrics.lowStockProducts.length > 0 ? (
            <ul className="mt-4 space-y-1">
              {metrics.lowStockProducts.map((product) => (
                <RestockRow key={product.id} product={product} />
              ))}
            </ul>
          ) : hasProducts ? (
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {t.dashboard.lowStockEmptyBody}
            </p>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {t.dashboard.inventoryEmptyBody}
            </p>
          )}
        </Card>
      </div>

      {/* AI Manager — straight into the live assistant */}
      <Link
        href="/dashboard/assistant"
        aria-label={t.dashboard.aiTeaserTitle}
        className="group block rounded-[1.75rem] transition-transform duration-300 ease-out hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500/60 active:translate-y-0"
      >
        <Card className="relative overflow-hidden">
          <div
            aria-hidden
            className="ambient-glow -left-20 -top-24 size-[300px]"
          />
          <div className="relative flex items-start gap-4">
            <BrandMark className="size-11 rounded-xl shadow-glow-btn" />
            <div>
              <h2 className="font-display text-xl font-light">
                {t.dashboard.aiTeaserTitle}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {t.dashboard.aiTeaserBody}
              </p>
            </div>
            <span className="ml-auto hidden size-9 items-center justify-center rounded-full border border-line text-muted transition-colors group-hover:border-emerald-500/40 group-hover:text-accent sm:flex">
              <SendIcon className="size-4" />
            </span>
          </div>
        </Card>
      </Link>
    </div>
  );
}

function MetricCard({
  href,
  icon,
  label,
  children,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <Card className="group flex flex-col items-start !p-5">
      <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-accent">
        {icon}
      </span>
      <p className="mt-3 text-xs uppercase tracking-widest text-faint">
        {label}
      </p>
      <div className="mt-1.5 w-full flex-1">{children}</div>
      <Link
        href={href}
        aria-label={label}
        className="mt-3 inline-flex min-h-8 items-center text-xs font-medium text-accent opacity-80 transition-all hover:text-accent-strong group-hover:opacity-100"
      >
        <span aria-hidden>→</span>
      </Link>
    </Card>
  );
}

function InventoryRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: "warning" | "danger";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt
        className={`flex items-center gap-1.5 ${
          tone === "warning"
            ? "text-foreground"
            : tone === "danger"
              ? "text-foreground"
              : "text-muted"
        }`}
      >
        {icon}
        {label}
      </dt>
      <dd className="font-medium">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}

function RestockRow({ product }: { product: LowStockEntry }) {
  const { t } = useI18n();
  const out = product.stockQuantity <= 0;
  return (
    <li className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{product.name}</p>
        <p
          className={`text-xs ${
            out
              ? "text-foreground"
              : "text-muted"
          }`}
        >
          {out
            ? t.dashboard.inventoryOutLabel
            : `${t.dashboard.lowStockItemUnit}: ${product.stockQuantity.toLocaleString("en-US")}`}
        </p>
      </div>
      <ChartIcon
        className={`size-4 shrink-0 ${
          out
            ? "text-muted"
            : "text-faint"
        }`}
        aria-hidden
      />
    </li>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
