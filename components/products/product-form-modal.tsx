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
import { SelectField } from "@/components/ui/select";
import {
  removeProductImage,
  uploadProductImage,
  validateImageFile,
} from "@/lib/products/storage";
import {
  ATTRIBUTE_VALUE_MAX_LENGTH,
  CLOTHING_ATTRIBUTE_KEYS,
  type ClothingAttributeKey,
} from "@/lib/business/product-attributes";
import { UNIT_MAX_LENGTH } from "@/lib/business/product-units";
import { hasCapability } from "@/lib/business/type-config";
import type { BusinessType } from "@/lib/business/constants";
import {
  buildAttributePayload,
  buildCostPriceExtras,
  clothingFieldsFromAttributes,
  clothingOptionEntries,
  CUSTOM_VALUE,
  isEmptyAttributePayload,
  optionFieldValue,
  unitFieldFromLabel,
  unitOptionEntries,
  validateAttributeFields,
  validateCostPriceField,
  validateUnitField,
  type OptionEntry,
  type OptionFieldState,
} from "@/lib/products/attribute-form";
import type { Product } from "@/lib/products/types";
import {
  validateProductInput,
  type ProductField,
  type ProductFieldError,
  type ProductFieldErrors,
} from "@/lib/products/validation";
import type { Dictionary } from "@/lib/i18n/dictionary";

type ProductFormModalProps = {
  businessId: string;
  /** The session's business type — decides whether the clothing section exists. */
  businessType: BusinessType;
  /** Existing product -> edit mode; omitted -> add mode. */
  product?: Product;
  categories: string[];
  onClose: () => void;
  onSaved: (product: Product, mode: "create" | "update") => void;
};

type ActionReason = keyof Dictionary["products"]["form"]["errors"];

type AttributeFieldErrors = Partial<Record<ClothingAttributeKey, ProductFieldError>>;

/**
 * Add/Edit product dialog. The image uploads directly from the browser to
 * Supabase Storage; if the upload fails the product can still be saved
 * without an image (image problems never block the record).
 */
export function ProductFormModal({
  businessId,
  businessType,
  product,
  categories,
  onClose,
  onSaved,
}: ProductFormModalProps) {
  const { t } = useI18n();
  const isEdit = Boolean(product);
  // One place decides whether this business has a clothing vocabulary at all.
  // A business without the capability sees no attribute field at all, and its
  // form behaves exactly as it did before — Unit and Cost price are for
  // everybody.
  const hasClothing = hasCapability(businessType, "fabric_attributes");
  // Only a product that really has a recorded cost price is offered the control
  // that can erase it — there is nothing to remove otherwise.
  const hasStoredCostPrice = isEdit && typeof product?.costPrice === "number";

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
  // Preloaded from the stored product, so an edit shows what is really saved.
  const [attributeFields, setAttributeFields] = useState(() =>
    clothingFieldsFromAttributes(product?.attributes ?? {}),
  );
  const [unitField, setUnitField] = useState<OptionFieldState>(() =>
    unitFieldFromLabel(product?.unit),
  );
  const [costPrice, setCostPrice] = useState(
    product?.costPrice === null || product?.costPrice === undefined
      ? ""
      : String(product.costPrice),
  );
  // Erasing a recorded cost price is its own explicit decision (docs/p5.txt),
  // so it gets its own state. Emptying the field on its own keeps meaning
  // "leave the saved cost alone", and typing a new amount cancels the removal.
  const [clearCostPrice, setClearCostPrice] = useState(false);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    product?.imageUrl ?? null,
  );
  const [imageRemoved, setImageRemoved] = useState(false);
  const [imageNotice, setImageNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fieldErrors, setFieldErrors] = useState<ProductFieldErrors>({});
  const [attributeErrors, setAttributeErrors] = useState<AttributeFieldErrors>({});
  const [unitError, setUnitError] = useState<string | undefined>(undefined);
  const [costPriceError, setCostPriceError] = useState<string | undefined>(undefined);
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

  function attributeErrorText(key: ClothingAttributeKey): string | undefined {
    const code = attributeErrors[key];
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

  function setAttributeChoice(key: ClothingAttributeKey, choice: string) {
    setAttributeFields((current) => ({
      ...current,
      // Switching to the custom choice keeps whatever was typed before, so a
      // mis-click never destroys the owner's own words.
      [key]: {
        choice,
        custom: current[key].choice === CUSTOM_VALUE ? current[key].custom : "",
      },
    }));
  }

  function setAttributeCustom(key: ClothingAttributeKey, custom: string) {
    setAttributeFields((current) => ({ ...current, [key]: { choice: CUSTOM_VALUE, custom } }));
  }

  function setUnitChoice(choice: string) {
    setUnitField((current) => ({
      choice,
      custom: current.choice === CUSTOM_VALUE ? current.custom : "",
    }));
  }

  function setUnitCustom(custom: string) {
    setUnitField({ choice: CUSTOM_VALUE, custom });
  }

  /** Typing a real amount is an instruction to keep a cost, not to clear one. */
  function setCostPriceField(value: string) {
    setCostPrice(value);
    if (value.trim() !== "") setClearCostPrice(false);
  }

  /** The single control that may erase a recorded cost price. */
  function toggleClearCostPrice() {
    const willClear = !clearCostPrice;
    setClearCostPrice(willClear);
    // Clearing empties the box so the owner can see the pending removal;
    // putting the cost back leaves the amount as it was.
    if (willClear) setCostPrice("");
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

    // The three new fields are validated with the SAME service-layer validators
    // the server runs, against the session's business type — so a message on the
    // screen is the message the server would have given, in the language the
    // owner is reading.
    const nextAttributeErrors = hasClothing
      ? validateAttributeFields(businessType, attributeFields)
      : {};
    const nextUnitError = validateUnitField(unitField);
    const nextCostPriceError = validateCostPriceField(costPrice);
    setAttributeErrors(nextAttributeErrors);
    setUnitError(nextUnitError ? t.products.form.fieldErrors[nextUnitError] : undefined);
    setCostPriceError(
      nextCostPriceError ? t.products.form.fieldErrors[nextCostPriceError] : undefined,
    );
    if (
      Object.keys(nextAttributeErrors).length > 0 ||
      nextUnitError !== null ||
      nextCostPriceError !== null
    ) {
      return;
    }

    // Attributes are a PATCH: only what the owner filled in, plus the keys they
    // emptied named for removal. Keys nobody touched stay exactly as saved.
    const attributePayload = buildAttributePayload(
      product?.attributes ?? {},
      attributeFields,
    );

    const extras: Record<string, unknown> = {
      unit: optionFieldValue(unitField),
      ...buildCostPriceExtras(costPrice, clearCostPrice),
    };
    if (hasClothing && !isEmptyAttributePayload(attributePayload)) {
      extras.attributes = attributePayload.attributes;
      if (isEdit) extras.clearAttributes = attributePayload.clearAttributes;
    }

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

    const payload = { ...validated.value, imageUrl: finalImageUrl, ...extras };

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

        {/* Unit — every business type. A LABEL shown next to the quantity
            ("50 Meter"); quantities stay whole numbers. */}
        <div className="grid gap-5 sm:grid-cols-2">
          <OptionFieldGroup
            selectId="product-unit"
            label={t.products.form.unitLabel}
            value={unitField}
            entries={unitOptionEntries()}
            placeholder={t.products.form.unitCustomPlaceholder}
            maxLength={UNIT_MAX_LENGTH}
            optional={false}
            hint={t.products.form.unitHint}
            error={unitError}
            disabled={busy}
            onChoice={setUnitChoice}
            onCustom={setUnitCustom}
          />
          <div className="w-full">
            <TextField
              id="product-cost-price"
              label={t.products.form.costPriceLabel}
              value={costPrice}
              onChange={(event) => setCostPriceField(event.target.value)}
              placeholder="0.00"
              // The cost price is the business's own private number: it must read
              // as an amount, not a selling price.
              inputMode="decimal"
              min={0}
              step="0.01"
              autoComplete="off"
              hint={
                hasStoredCostPrice
                  ? `${t.products.form.costPriceHint} ${t.products.form.costPriceKeepHint}`
                  : t.products.form.costPriceHint
              }
              error={costPriceError}
            />
            {/* A saved cost price can only be erased through this one control, so
                clearing the text field alone never silently destroys it. */}
            {hasStoredCostPrice ? (
              <div className="mt-2 flex flex-col gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  aria-pressed={clearCostPrice}
                  onClick={toggleClearCostPrice}
                  disabled={busy}
                  className="min-h-9 px-3 text-xs"
                >
                  {clearCostPrice
                    ? t.products.form.costPriceKeepButton
                    : t.products.form.costPriceRemoveButton}
                </Button>
                {clearCostPrice ? (
                  <p
                    role="status"
                    className="flex items-start gap-1.5 text-xs leading-relaxed text-muted"
                  >
                    <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
                    {t.products.form.costPriceRemovingHint}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* Clothing details — only for a business type whose vocabulary has the
            fabric attributes. Every other type sees nothing here. */}
        {hasClothing ? (
          <fieldset className="space-y-5">
            <legend className="text-sm font-medium text-foreground">
              {t.products.form.clothingTitle}
            </legend>
            <p className="-mt-3 text-xs leading-relaxed text-faint">
              {t.products.form.clothingHint}
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              {CLOTHING_ATTRIBUTE_KEYS.map((key) => (
                <OptionFieldGroup
                  key={key}
                  selectId={`product-${key}`}
                  label={t.products.form.attributeLabels[key]}
                  value={attributeFields[key]}
                  entries={clothingOptionEntries(key)}
                  placeholder={t.products.form.customValuePlaceholder}
                  maxLength={ATTRIBUTE_VALUE_MAX_LENGTH}
                  error={attributeErrorText(key)}
                  disabled={busy}
                  onChoice={(choice) => setAttributeChoice(key, choice)}
                  onCustom={(custom) => setAttributeCustom(key, custom)}
                />
              ))}
            </div>
          </fieldset>
        ) : null}

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

/**
 * One "pick a value, or type your own" control, used for the clothing
 * attributes and for the unit label.
 *
 * The select always offers every predefined value plus one custom choice; the
 * text input only appears once that choice is picked, so the form is short for
 * the 95% of owners who pick a common value. The option NAMES are product data
 * and stay in their stored English spelling in both languages — only the
 * control's own labels ("Not set", "Custom…") are translated.
 *
 * `optional={false}` (the unit) drops the empty choice: a unit is always
 * recorded, so the owner cannot pick a state the product has no answer for.
 */
function OptionFieldGroup({
  selectId,
  label,
  value,
  entries,
  placeholder,
  maxLength,
  optional = true,
  hint,
  error,
  disabled,
  onChoice,
  onCustom,
}: {
  selectId: string;
  label: string;
  value: OptionFieldState;
  entries: readonly OptionEntry[];
  placeholder: string;
  maxLength: number;
  optional?: boolean;
  hint?: string;
  error?: string;
  disabled?: boolean;
  onChoice: (choice: string) => void;
  onCustom: (custom: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="w-full space-y-3">
      <SelectField
        id={selectId}
        label={label}
        value={value.choice}
        onChange={(event) => onChoice(event.target.value)}
        hint={hint}
        error={error}
        disabled={disabled}
      >
        {optional ? <option value="">{t.products.form.notSetOption}</option> : null}
        {entries.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.custom ? t.products.form.customOption : entry.value}
          </option>
        ))}
      </SelectField>
      {value.choice === CUSTOM_VALUE ? (
        <TextField
          id={`${selectId}-custom`}
          label={t.products.form.customValueLabel}
          value={value.custom}
          onChange={(event) => onCustom(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}
