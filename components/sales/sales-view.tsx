"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChartIcon, TrendingUpIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import type { CurrencyCode } from "@/lib/business/constants";
import { formatMoney } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/date";
import type {
  SaleEntry,
  SalesPeriodStats,
  SalesSummary,
} from "@/lib/sales/service";

type SalesViewProps = {
  currency: CurrencyCode;
  summary: SalesSummary | null;
  recentSales: SaleEntry[];
  /** True when the initial server-side fetch failed — show an honest error. */
  loadFailed?: boolean;
};

/**
 * Sales overview: real revenue from completed orders only. Period cards +
 * the latest sales feed — no estimates, no fabricated charts.
 */
export function SalesView({
  currency,
  summary,
  recentSales,
  loadFailed = false,
}: SalesViewProps) {
  const { t, language } = useI18n();

  const periods: Array<{
    key: keyof SalesSummary;
    label: string;
    stats: SalesPeriodStats | null;
  }> = [
    { key: "today", label: t.sales.periodToday, stats: summary?.today ?? null },
    { key: "week", label: t.sales.periodWeek, stats: summary?.week ?? null },
    { key: "month", label: t.sales.periodMonth, stats: summary?.month ?? null },
    {
      key: "allTime",
      label: t.sales.periodAllTime,
      stats: summary?.allTime ?? null,
    },
  ];

  if (loadFailed) {
    return (
      <div className="space-y-6">
        <SalesHeader />
        <Card lift={false} className="flex flex-col items-center py-14 text-center">
          <p className="text-sm text-muted">{t.sales.loadError}</p>
          <Button
            variant="secondary"
            size="lg"
            className="mt-6"
            onClick={() => window.location.reload()}
          >
            {t.common.tryAgain}
          </Button>
        </Card>
      </div>
    );
  }

  const hasSales = (summary?.allTime.orderCount ?? 0) > 0;

  return (
    <div className="space-y-6">
      <SalesHeader />

      {/* Period cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {periods.map((period) => (
          <Card key={period.key} lift={false} className="!p-5">
            <p className="text-xs uppercase tracking-widest text-faint">
              {period.label}
            </p>
            {period.stats ? (
              <>
                <p className="mt-2 font-display text-3xl font-light tabular-nums leading-tight">
                  {formatMoney(period.stats.revenue, currency)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {period.stats.orderCount.toLocaleString("en-US")}{" "}
                  {t.sales.ordersCountLabel}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-faint">—</p>
            )}
          </Card>
        ))}
      </div>

      {hasSales ? (
        /* Recent completed sales */
        <Card lift={false}>
          <h2 className="text-sm font-medium uppercase tracking-widest text-faint">
            {t.sales.recentTitle}
          </h2>
          <ul className="mt-4 space-y-1">
            {recentSales.map((sale) => (
              <li
                key={sale.id}
                className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium tabular-nums">
                    {sale.orderNumber}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {sale.customerName ?? t.sales.walkIn} ·{" "}
                    {formatDate(sale.orderedAt, language)}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  +{formatMoney(sale.total, currency)}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/dashboard/orders"
            className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-accent transition-colors hover:text-accent-strong"
          >
            {t.sales.viewOrdersLink}
            <span aria-hidden>→</span>
          </Link>
        </Card>
      ) : (
        /* Honest empty state */
        <Card lift={false} className="relative overflow-hidden">
          <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
          <div className="relative flex flex-col items-center py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
              <ChartIcon className="size-6" />
            </span>
            <h2 className="mt-5 font-display text-2xl font-light">
              {t.sales.emptyTitle}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              {t.sales.emptyBody}
            </p>
            <Link href="/dashboard/orders" className="mt-7">
              <Button size="lg">
                {t.sales.createOrderButton}
              </Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

function SalesHeader() {
  const { t } = useI18n();
  return (
    <PageHeader
      eyebrow={
        <>
          <TrendingUpIcon className="size-3.5" />
          {t.nav.sales}
        </>
      }
      title={t.sales.title}
      subtitle={t.sales.subtitle}
    />
  );
}
