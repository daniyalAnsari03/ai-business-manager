"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { createProductAction, updateProductAction } from "@/app/actions/products";
import { useI18n } from "@/components/i18n/language-provider";
import { Button } from "@/components/ui/button";
import {
  AlertCircleIcon,
  ImageIcon,
  PackageIcon,
} from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/input";
import {
  removeProductImage,
  uploadProductImage,
  validateImageFile,
} from "@/lib/products/storage";
import type { Product } from "@/lib/products/types";
import {
  validateProductInput,
  type ProductField,
  type ProductFieldErrors,
} from "@/lib/products/validation";
import type { Dictionary } from "@/lib/i18n/dictionary";

type ProductFormModalProps = {
  businessId: string;
  /** Existing product -> edit mode; omitted -> add mode. */
  product?: Product;
  categories: string[];
  onClose: () => void;
  onSaved: (product: Product, mode: "create" | "update") => void;
};

type ActionReason = keyof Dictionary["products"]["form"]["errors"];

/**
 * Add/Edit product dialog. The image uploads directly from the browser to
 * Supabase Storage; if the upload fails the product can still be saved
 * without an image (image problems never block the record).
 */
export function ProductFormModal({
  businessId,
  product,
  categories,
  onClose,
  onSaved,
}: ProductFormModalProps) {
  const { t } = useI18n();
  const isEdit = Boolean(product);

  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [price, setPrice] = useState(
    product ? String(product.price) : "",
  );
  const [stockQuantity, setStockQuantity] = useState(
    product ? String(product.stockQuantity) : "",
  );
  const [lowStockThreshold, setLowStockThreshold] = useState(
    product ? String(product.lowStockThreshold) : "5",
  );
  const [sku, setSku] = useState(product?.sku ?? "");

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    product?.imageUrl ?? null,
  );
  const [imageRemoved, setImageRemoved] = useState(false);
  const [imageNotice, setImageNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fieldErrors, setFieldErrors] = useState<ProductFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Object-URL lifecycle for the local preview.
  useEffect(() => {
    if (!imageFile) return;
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  function fieldErrorText(field: ProductField): string | undefined {
    const code = fieldErrors[field];
    return code ? t.products.form.fieldErrors[code] : undefined;
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setImageNotice(null);

    if (!file) {
      setImageFile(null);
      return;
    }
    const invalid = validateImageFile(file);
    if (invalid === "too_large") {
      setImageNotice(t.products.form.imageTooLarge);
      return;
    }
    if (invalid === "bad_type") {
      setImageNotice(t.products.form.imageBadType);
      return;
    }
    setImageFile(file);
    setImageRemoved(false);
  }

  function handleImageRemove() {
    setImageFile(null);
    setPreviewUrl(null);
    setImageRemoved(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    // Client-side boundary check (the service re-validates server-side).
    const validated = validateProductInput({
      name,
      description,
      category,
      price,
      // In edit mode the stock stays untouched here — it has its own
      // dedicated update experience.
      stockQuantity: isEdit ? product!.stockQuantity : stockQuantity,
      lowStockThreshold,
      sku,
      imageUrl: null,
    });

    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors);
      return;
    }
    setFieldErrors({});

    setPending(true);

    // Resolve the final image URL without ever blocking the save on it.
    let finalImageUrl: string | null = isEdit ? product!.imageUrl : null;
    const previousImageUrl: string | null = isEdit ? product!.imageUrl : null;

    if (imageFile) {
      setUploading(true);
      const result = await uploadProductImage(imageFile, businessId);
      setUploading(false);
      if (result.ok) {
        finalImageUrl = result.url;
        setImageNotice(null);
      } else {
        finalImageUrl = isEdit ? product!.imageUrl : null;
        setImageNotice(t.products.form.imageUploadFailed);
      }
    } else if (isEdit && imageRemoved) {
      finalImageUrl = null;
    }

    const payload = { ...validated.value, imageUrl: finalImageUrl };

    const result = isEdit
      ? await updateProductAction(product!.id, payload)
      : await createProductAction(payload);

    if (!result.ok) {
      setPending(false);
      setFormError(t.products.form.errors[result.reason as ActionReason]);
      return;
    }

    // Best-effort cleanup of a replaced image — never blocks the flow.
    if (
      previousImageUrl &&
      finalImageUrl &&
      previousImageUrl !== finalImageUrl
    ) {
      void removeProductImage(previousImageUrl);
    }

    onSaved(result.product, isEdit ? "update" : "create");
  }

  const busy = pending || uploading;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? t.products.form.editTitle : t.products.form.addTitle}
      description={
        isEdit ? t.products.form.editDescription : t.products.form.addDescription
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* Image picker */}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-foreground">
            {t.products.form.imageLabel}
          </span>
          <div className="flex items-center gap-4">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-raised shadow-card">
              {previewUrl ? (
                <Image
                  src={previewUrl}
                  alt=""
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-faint">
                  <PackageIcon className="size-7" />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                >
                  <ImageIcon className="size-4" />
                  {previewUrl
                    ? t.products.form.imageChange
                    : t.products.form.imageLabel}
                </Button>
                {previewUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    onClick={handleImageRemove}
                    disabled={busy}
                  >
                    {t.products.form.imageRemove}
                  </Button>
                ) : null}
              </div>
              <p className="text-xs leading-relaxed text-faint">
                {t.products.form.imageHint}
              </p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            onChange={handleImageChange}
            className="sr-only"
            aria-label={t.products.form.imageLabel}
            disabled={busy}
          />
          {uploading ? (
            <p
              role="status"
              className="mt-2 flex items-center gap-2 text-xs text-accent"
            >
              <Spinner />
              {t.products.form.imageUploading}
            </p>
          ) : null}
          {imageNotice ? (
            <p
              role="alert"
              className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted"
            >
              <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
              {imageNotice}
            </p>
          ) : null}
        </div>

        <TextField
          id="product-name"
          label={t.products.form.nameLabel}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t.products.form.namePlaceholder}
          error={fieldErrorText("name")}
          maxLength={120}
          autoComplete="off"
          required
        />

        {/* Description */}
        <div className="w-full">
          <label
            htmlFor="product-description"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {t.products.form.descriptionLabel}
          </label>
          <textarea
            id="product-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t.products.form.descriptionPlaceholder}
            rows={3}
            maxLength={2000}
            className="min-h-[5.5rem] w-full resize-y rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-foreground shadow-card transition-colors duration-200 placeholder:text-faint hover:border-emerald-500/30 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
          />
        </div>

        <TextField
          id="product-category"
          label={t.products.form.categoryLabel}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder={t.products.form.categoryPlaceholder}
          hint={t.products.form.categoryHint}
          error={fieldErrorText("category")}
          list="product-category-options"
          maxLength={60}
          autoComplete="off"
          required
        />
        <datalist id="product-category-options">
          {categories.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id="product-price"
            label={`${t.products.form.priceLabel}`}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="0"
            inputMode="decimal"
            autoComplete="off"
            error={fieldErrorText("price")}
            required
          />
          {!isEdit ? (
            <TextField
              id="product-stock"
              label={t.products.form.stockLabel}
              value={stockQuantity}
              onChange={(event) => setStockQuantity(event.target.value)}
              placeholder="0"
              hint={t.products.form.stockHint}
              inputMode="numeric"
              autoComplete="off"
              error={fieldErrorText("stockQuantity")}
              required
            />
          ) : null}
          <TextField
            id="product-threshold"
            label={t.products.form.thresholdLabel}
            value={lowStockThreshold}
            onChange={(event) => setLowStockThreshold(event.target.value)}
            placeholder="5"
            hint={t.products.form.thresholdHint}
            inputMode="numeric"
            autoComplete="off"
            error={fieldErrorText("lowStockThreshold")}
            required
          />
          <TextField
            id="product-sku"
            label={t.products.form.skuLabel}
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            placeholder="BK-001"
            hint={t.products.form.skuHint}
            maxLength={60}
            autoComplete="off"
            error={fieldErrorText("sku")}
          />
        </div>

        {formError ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-relaxed text-muted"
          >
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
            {formError}
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={onClose}
            disabled={busy}
            className="w-full sm:w-auto"
          >
            {t.products.form.cancelButton}
          </Button>
          <Button type="submit" size="lg" disabled={busy} className="w-full sm:w-auto">
            {busy ? (
              <>
                <Spinner />
                {uploading
                  ? t.products.form.imageUploading
                  : t.products.form.savingButton}
              </>
            ) : (
              t.products.form.saveButton
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
    />
  );
}
