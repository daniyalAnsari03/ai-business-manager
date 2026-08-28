"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ProductCard } from "@/components/products/product-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/components/i18n/language-provider";

// Lazy-load the CRUD modals so they are code-split out of the Products page's
// initial chunk. They only ever render after a user opens them, so deferring
// their JS until first open keeps the module's initial payload lean without
// changing any behaviour.
const DeleteProductDialog = dynamic(
  () => import("@/components/products/delete-product-dialog").then((m) => m.DeleteProductDialog),
  { ssr: false },
);
const ProductFormModal = dynamic(
  () => import("@/components/products/product-form-modal").then((m) => m.ProductFormModal),
  { ssr: false },
);
const StockUpdateModal = dynamic(
  () => import("@/components/products/stock-update-modal").then((m) => m.StockUpdateModal),
  { ssr: false },
);
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  XCircleIcon,
  XIcon,
} from "@/components/ui/icons";
import type { Business, } from "@/lib/business/types";
import type { CurrencyCode } from "@/lib/business/constants";
import { EASE_PREMIUM, fadeUp, staggerContainer } from "@/components/motion/presets";
import { computeProductStats, type Product } from "@/lib/products/types";
import { cn } from "@/lib/utils";

type ProductsViewProps = {
  business: Business;
  initialProducts: Product[];
  /** True when the initial server-side fetch failed — show an honest error, never a fake empty state. */
  loadFailed?: boolean;
};

type ActiveModal =
  | { kind: "add" }
  | { kind: "edit"; product: Product }
  | { kind: "stock"; product: Product }
  | { kind: "delete"; product: Product }
  | null;

type Toast = { id: number; kind: "success" | "error"; text: string };

/**
 * Products & inventory workspace. All data is real (Supabase); mutations go
 * through server actions and update local state only after confirmed
 * success — nothing is ever faked.
 */
export function ProductsView({ business, initialProducts, loadFailed = false }: ProductsViewProps) {
  const { t } = useI18n();
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ActiveModal>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const stats = useMemo(() => computeProductStats(products), [products]);

  const categories = useMemo(
    () =>
      Array.from(new Set(products.map((p) => p.category.trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [products],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return products;
    return products.filter((product) => {
      const haystack = [
        product.name,
        product.sku ?? "",
        product.category,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [products, query]);

  function showToast(kind: Toast["kind"], text: string) {
    setToast({ id: Date.now(), kind, text });
  }

  function handleSaved(product: Product, mode: "create" | "update") {
    setProducts((current) =>
      mode === "create"
        ? [product, ...current]
        : current.map((item) => (item.id === product.id ? product : item)),
    );
    setModal(null);
    showToast(
      "success",
      mode === "create"
        ? t.products.toasts.created.replace("{name}", product.name)
        : t.products.toasts.updated.replace("{name}", product.name),
    );
  }

  function handleStockSaved(product: Product) {
    setProducts((current) =>
      current.map((item) => (item.id === product.id ? product : item)),
    );
    setModal(null);
    showToast(
      "success",
      t.products.toasts.stockUpdated.replace("{name}", product.name),
    );
  }

  function handleDeleted(id: string) {
    const deletedName =
      modal?.kind === "delete" ? modal.product.name : "";
    setProducts((current) => current.filter((item) => item.id !== id));
    setModal(null);
    showToast("success", t.products.toasts.deleted.replace("{name}", deletedName));
  }

  const hasProducts = products.length > 0;
  const isSearching = query.trim().length > 0;

  if (loadFailed) {
    return (
      <Card lift={false} className="relative overflow-hidden">
        <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
        <div className="relative flex flex-col items-center py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground">
            <AlertTriangleIcon className="size-6" />
          </span>
          <h2 className="mt-5 font-display text-2xl font-light">
            {t.products.loadError}
          </h2>
          <Button variant="secondary" size="lg" className="mt-7" onClick={() => router.refresh()}>
            {t.common.tryAgain}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow={
          <>
            <PackageIcon className="size-3.5" />
            {t.nav.products}
          </>
        }
        title={t.products.title}
        subtitle={t.products.subtitle}
        action={
          hasProducts ? (
            <Button size="lg" onClick={() => setModal({ kind: "add" })}>
              <PlusIcon className="size-[18px]" />
              {t.products.addButton}
            </Button>
          ) : undefined
        }
      />

      {hasProducts ? (
        <>
          {/* Real inventory summary */}
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryCard
              icon={<PackageIcon className="size-4" />}
              label={t.products.summaryTotal}
              value={stats.totalProducts}
            />
            <SummaryCard
              icon={<AlertTriangleIcon className="size-4" />}
              label={t.products.summaryLowStock}
              value={stats.lowStockCount}
              tone={stats.lowStockCount > 0 ? "warning" : undefined}
            />
            <SummaryCard
              icon={<XCircleIcon className="size-4" />}
              label={t.products.summaryOutOfStock}
              value={stats.outOfStockCount}
              tone={stats.outOfStockCount > 0 ? "danger" : undefined}
            />
          </div>

          {/* Search */}
          <div className="max-w-md">
            <div className="relative">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-faint"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.products.searchPlaceholder}
                aria-label={t.products.searchLabel}
                className="min-h-12 w-full rounded-full border border-line bg-surface pl-11 pr-11 text-[15px] text-foreground shadow-card transition-colors duration-200 placeholder:text-faint hover:border-emerald-500/30 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 [&::-webkit-search-cancel-button]:hidden"
              />
              {isSearching ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={t.products.searchClear}
                  className="absolute right-1.5 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                >
                  <XIcon className="size-4" />
                </button>
              ) : null}
            </div>
            {isSearching ? (
              <p className="mt-2 px-1 text-xs text-faint" role="status">
                {t.products.resultsFound.replace("{count}", String(filtered.length))}
              </p>
            ) : null}
          </div>

          {/* Grid */}
          {filtered.length > 0 ? (
            reducedMotion ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((product) => (
                  <GridItem
                    key={product.id}
                    product={product}
                    currency={business.currency}
                    onEdit={(p) => setModal({ kind: "edit", product: p })}
                    onStock={(p) => setModal({ kind: "stock", product: p })}
                    onDelete={(p) => setModal({ kind: "delete", product: p })}
                  />
                ))}
              </div>
            ) : (
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
              >
                {filtered.map((product) => (
                  <motion.div key={product.id} variants={fadeUp}>
                    <GridItem
                      product={product}
                      currency={business.currency}
                      onEdit={(p) => setModal({ kind: "edit", product: p })}
                      onStock={(p) => setModal({ kind: "stock", product: p })}
                      onDelete={(p) => setModal({ kind: "delete", product: p })}
                    />
                  </motion.div>
                ))}
              </motion.div>
            )
          ) : (
            <Card lift={false} className="flex flex-col items-center py-14 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
                <SearchIcon className="size-5" />
              </span>
              <h2 className="mt-4 text-[15px] font-medium">
                {t.products.noResultsTitle}
              </h2>
              <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
                {t.products.noResultsBody}
              </p>
            </Card>
          )}
        </>
      ) : (
        /* Honest empty state — no fake data */
        <Card lift={false} className="relative overflow-hidden">
          <div aria-hidden className="ambient-glow -left-16 -top-20 size-[280px]" />
          <div className="relative flex flex-col items-center py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
              <PackageIcon className="size-6" />
            </span>
            <h2 className="mt-5 font-display text-2xl font-light">
              {t.products.emptyTitle}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              {t.products.emptyBody}
            </p>
            <Button
              size="lg"
              className="mt-7"
              onClick={() => setModal({ kind: "add" })}
            >
              <PlusIcon className="size-[18px]" />
              {t.products.addButton}
            </Button>
          </div>
        </Card>
      )}

      {/* Modals — keyed so each open starts from a fresh form */}
      {modal?.kind === "add" ? (
        <ProductFormModal
          key="add"
          businessId={business.id}
          categories={categories}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}
      {modal?.kind === "edit" ? (
        <ProductFormModal
          key={`edit-${modal.product.id}`}
          businessId={business.id}
          product={modal.product}
          categories={categories}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}
      {modal?.kind === "stock" ? (
        <StockUpdateModal
          key={`stock-${modal.product.id}`}
          product={modal.product}
          onClose={() => setModal(null)}
          onSaved={handleStockSaved}
        />
      ) : null}
      {modal?.kind === "delete" ? (
        <DeleteProductDialog
          key={`delete-${modal.product.id}`}
          product={modal.product}
          onClose={() => setModal(null)}
          onDeleted={handleDeleted}
        />
      ) : null}

      {/* Feedback */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
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

function GridItem({
  product,
  currency,
  onEdit,
  onStock,
  onDelete,
}: {
  product: Product;
  currency: CurrencyCode;
  onEdit: (product: Product) => void;
  onStock: (product: Product) => void;
  onDelete: (product: Product) => void;
}) {
  return (
    <ProductCard
      product={product}
      currency={currency}
      onEdit={onEdit}
      onStock={onStock}
      onDelete={onDelete}
    />
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "warning" | "danger";
}) {
  return (
    <Card lift={false} className="flex items-center gap-4 !p-5">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl",
          tone === "warning"
            ? "bg-foreground/[0.06] text-foreground"
            : tone === "danger"
              ? "bg-foreground/[0.1] text-foreground"
              : "bg-emerald-500/10 text-accent",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs uppercase tracking-widest text-faint">
          {label}
        </p>
        <p className="font-display text-2xl font-light leading-tight">
          {value.toLocaleString("en-US")}
        </p>
      </div>
    </Card>
  );
}
