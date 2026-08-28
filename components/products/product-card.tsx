"use client";

import Image from "next/image";
import { useI18n } from "@/components/i18n/language-provider";
import {
  AlertTriangleIcon,
  BoxesIcon,
  CheckCircleIcon,
  PackageIcon,
  PencilIcon,
  TrashIcon,
  XCircleIcon,
} from "@/components/ui/icons";
import type { CurrencyCode } from "@/lib/business/constants";
import { formatMoney } from "@/lib/format/currency";
import type { Product } from "@/lib/products/types";
import { getStockStatus } from "@/lib/products/types";
import { cn } from "@/lib/utils";

type ProductCardProps = {
  product: Product;
  currency: CurrencyCode;
  onEdit: (product: Product) => void;
  onStock: (product: Product) => void;
  onDelete: (product: Product) => void;
};

/** One product tile: image, identity, live stock status and quick actions. */
export function ProductCard({
  product,
  currency,
  onEdit,
  onStock,
  onDelete,
}: ProductCardProps) {
  const { t } = useI18n();
  const status = getStockStatus(product.stockQuantity, product.lowStockThreshold);

  const statusConfig = {
    in_stock: {
      label: t.products.statusInStock,
      icon: CheckCircleIcon,
      classes: "border-emerald-500/40 bg-emerald-950/70 text-emerald-300",
    },
    low_stock: {
      label: t.products.statusLowStock,
      icon: AlertTriangleIcon,
      classes: "border-white/15 bg-black/50 text-white/85",
    },
    out_of_stock: {
      label: t.products.statusOutOfStock,
      icon: XCircleIcon,
      classes: "border-white/15 bg-black/60 text-white/65",
    },
  } as const;

  const StatusIcon = statusConfig[status].icon;

  return (
    <article className="card-surface card-lift group flex h-full flex-col overflow-hidden !p-0">
      {/* Image */}
      <div className="relative aspect-[5/3] w-full overflow-hidden bg-surface-raised">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center" aria-hidden>
            <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-accent">
              <PackageIcon className="size-6" />
            </span>
          </div>
        )}
        <span
          className={cn(
            "absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm",
            statusConfig[status].classes,
          )}
        >
          <StatusIcon className="size-3.5" />
          {statusConfig[status].label}
        </span>
      </div>

      {/* Identity */}
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate rounded-full border border-line px-2.5 py-0.5 text-[11px] uppercase tracking-wider text-faint">
            {product.category}
          </span>
          {product.sku ? (
            <span className="shrink-0 text-[11px] text-faint">
              {t.products.skuPrefix} {product.sku}
            </span>
          ) : null}
        </div>

        <h3 className="mt-3 line-clamp-2 text-[15px] font-medium leading-snug">
          {product.name}
        </h3>

        <p className="mt-1.5 text-[15px] font-medium text-accent">
          {formatMoney(product.price, currency)}
        </p>

        <p className="mt-auto pt-3 text-sm text-muted">
          {product.stockQuantity.toLocaleString("en-US")}{" "}
          {t.products.pcsUnit}
        </p>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-3 divide-x divide-line border-t border-line">
        <CardAction
          icon={<PencilIcon className="size-4" />}
          label={t.products.cardEdit}
          onClick={() => onEdit(product)}
        />
        <CardAction
          icon={<BoxesIcon className="size-4" />}
          label={t.products.cardStock}
          onClick={() => onStock(product)}
        />
        <CardAction
          icon={<TrashIcon className="size-4" />}
          label={t.products.cardDelete}
          destructive
          onClick={() => onDelete(product)}
        />
      </div>
    </article>
  );
}

function CardAction({
  icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 px-2 text-[13px] font-medium transition-colors",
        "text-muted hover:bg-surface-raised hover:text-foreground",
        destructive && "hover:bg-foreground/[0.08] hover:text-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
