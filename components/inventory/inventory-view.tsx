"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { StockAdjustModal } from "@/components/inventory/stock-adjust-modal";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertTriangleIcon,
  ArchiveIcon,
  CheckCircleIcon,
  PackageIcon,
  XCircleIcon,
} from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { StatCard } from "@/components/ui/stat-card";
import { fadeUp, staggerContainer } from "@/components/motion/presets";
import type { Product } from "@/lib/products/types";
import { cn } from "@/lib/utils";

type InventoryViewProps = {
  initialProducts: Product[];
  /** True when the initial server-side fetch failed — show an honest error. */
  loadFailed?: boolean;
};

type Toast = { id: number; kind: "success" | "error"; text: string };

type StockState = "in" | "low" | "out";

function stockState(product: Product): StockState {
  if (product.stockQuantity <= 0) return "out";
  if (product.stockQuantity <= product.lowStockThreshold) return "low";
  return "in";
}

/**
 * Live inventory over the business's real products. Adjustments go through
 * an atomic database function so concurrent orders and edits stay safe.
 */
export function InventoryView({
  initialProducts,
  loadFailed = false,
}: InventoryViewProps) {
  const { t } = useI18n();
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [query, setQuery] = useState("");
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const liveStats = useMemo(() => {
    let low = 0;
    let out = 0;
    for (const product of products) {
      const state = stockState(product);
      if (state === "out") out += 1;
      else if (state === "low") low += 1;
    }
    return { total: products.length, low, out };
  }, [products]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return products;
    return products.filter((product) =>
      [product.name, product.sku ?? "", product.category]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [products, query]);

  function showToast(kind: Toast["kind"], text: string) {
    setToast({ id: Date.now(), kind, text });
  }

  function handleAdjusted(updated: Product) {
    setProducts((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    setAdjusting(null);
    showToast(
      "success",
      t.inventory.toasts.adjusted.replace("{name}", updated.name),
    );
  }

  const hasProducts = products.length > 0;

  if (loadFailed) {
    return (
      <Card lift={false} className="relative overflow-hidden">
        <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
        <div className="relative flex flex-col items-center py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground">
            <AlertTriangleIcon className="size-6" />
          </span>
          <h2 className="mt-5 font-display text-2xl font-light">
            {t.inventory.loadError}
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
            <ArchiveIcon className="size-3.5" />
            {t.nav.inventory}
          </>
        }
        title={t.inventory.title}
        subtitle={t.inventory.subtitle}
      />

      {hasProducts ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              icon={<PackageIcon className="size-4" />}
              label={t.inventory.summaryTotal}
              value={liveStats.total.toLocaleString("en-US")}
            />
            <StatCard
              icon={<AlertTriangleIcon className="size-4" />}
              label={t.inventory.summaryLowStock}
              value={liveStats.low.toLocaleString("en-US")}
              tone={liveStats.low > 0 ? "warning" : undefined}
            />
            <StatCard
              icon={<XCircleIcon className="size-4" />}
              label={t.inventory.summaryOutOfStock}
              value={liveStats.out.toLocaleString("en-US")}
              tone={liveStats.out > 0 ? "danger" : undefined}
            />
          </div>

          <SearchInput
            label={t.inventory.searchLabel}
            placeholder={t.inventory.searchPlaceholder}
            clearLabel={t.inventory.searchClear}
            value={query}
            onChange={setQuery}
            resultText={
              query.trim()
                ? t.inventory.resultsFound.replace("{count}", String(filtered.length))
                : undefined
            }
          />

          {filtered.length > 0 ? (
            reducedMotion ? (
              <InventoryListBlock>
                {filtered.map((product) => (
                  <InventoryRow
                    key={product.id}
                    product={product}
                    onAdjust={setAdjusting}
                  />
                ))}
              </InventoryListBlock>
            ) : (
              <motion.div variants={staggerContainer} initial="hidden" animate="visible">
                <InventoryListBlock>
                  {filtered.map((product) => (
                    <motion.div key={product.id} variants={fadeUp}>
                      <InventoryRow product={product} onAdjust={setAdjusting} />
                    </motion.div>
                  ))}
                </InventoryListBlock>
              </motion.div>
            )
          ) : (
            <Card lift={false} className="flex flex-col items-center py-14 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
                <PackageIcon className="size-5" />
              </span>
              <h2 className="mt-4 text-[15px] font-medium">
                {t.inventory.noResultsTitle}
              </h2>
              <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
                {t.inventory.noResultsBody}
              </p>
            </Card>
          )}
        </>
      ) : (
        /* Honest empty state — inventory follows products */
        <Card lift={false} className="relative overflow-hidden">
          <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
          <div className="relative flex flex-col items-center py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
              <ArchiveIcon className="size-6" />
            </span>
            <h2 className="mt-5 font-display text-2xl font-light">
              {t.inventory.emptyTitle}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              {t.inventory.emptyBody}
            </p>
            <Link href="/dashboard/products" className="mt-7">
              <Button size="lg">
                <PackageIcon className="size-[18px]" />
                {t.inventory.browseProducts}
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {adjusting ? (
        <StockAdjustModal
          key={`adjust-${adjusting.id}`}
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={handleAdjusted}
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
              transition={{ duration: 0.3 }}
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

function InventoryListBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {/* Header row (desktop only) */}
      <InventoryHeaderRow />
      {children}
    </div>
  );
}

function InventoryHeaderRow() {
  const { t } = useI18n();
  return (
    <div className="hidden items-center gap-4 border-b border-line bg-surface-raised/50 px-5 py-2.5 text-[11px] font-medium uppercase tracking-widest text-faint md:flex">
      <span className="min-w-0 flex-1">{t.inventory.colProduct}</span>
      <span className="w-32 shrink-0 truncate">{t.inventory.colCategory}</span>
      <span className="w-24 shrink-0 text-right">{t.inventory.colStock}</span>
      <span className="w-28 shrink-0 text-right">{t.inventory.colStatus}</span>
      <span className="w-[6.5rem] shrink-0 text-right">{t.inventory.colAdjust}</span>
    </div>
  );
}

function StockChip({ state }: { state: StockState }) {
  const { t } = useI18n();
  const label =
    state === "out"
      ? t.inventory.statusOutStock
      : state === "low"
        ? t.inventory.statusLowStock
        : t.inventory.statusInStock;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium",
        state === "out"
          ? "border-faint/40 bg-surface-raised text-faint"
          : state === "low"
            ? "border-line bg-surface-raised text-muted"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      )}
    >
      {label}
    </span>
  );
}

function InventoryRow({
  product,
  onAdjust,
}: {
  product: Product;
  onAdjust: (product: Product) => void;
}) {
  const { t } = useI18n();

  return (
    <div>
      {/* Mobile card */}
      <div className="flex items-start justify-between gap-3 border-b border-line p-4 last:border-b-0 md:hidden">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium">{product.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {product.category || product.sku || "—"}
          </p>
          <p className="mt-1 text-xs tabular-nums text-faint">
            {t.inventory.colStock}:{" "}
            <span className="font-medium text-foreground">
              {product.stockQuantity.toLocaleString("en-US")}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StockChip state={stockState(product)} />
          <Button variant="secondary" size="md" onClick={() => onAdjust(product)}>
            {t.inventory.adjustButton}
          </Button>
        </div>
      </div>

      {/* Desktop row */}
      <div className="hidden items-center gap-4 border-b border-line px-5 py-3.5 transition-colors last:border-b-0 hover:bg-surface-raised/60 md:flex">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{product.name}</p>
          {product.sku ? (
            <p className="truncate text-xs text-faint">{product.sku}</p>
          ) : null}
        </div>
        <div className="w-32 shrink-0 truncate text-sm text-muted">
          {product.category || "—"}
        </div>
        <div className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">
          {product.stockQuantity.toLocaleString("en-US")}
        </div>
        <div className="flex w-28 shrink-0 justify-end">
          <StockChip state={stockState(product)} />
        </div>
        <div className="flex w-[6.5rem] shrink-0 justify-end">
          <Button variant="secondary" size="md" onClick={() => onAdjust(product)}>
            {t.inventory.adjustButton}
          </Button>
        </div>
      </div>
    </div>
  );
}
