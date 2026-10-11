/**
 * Business type capability configuration (docs/fix.txt — File 3 / Step 2a).
 *
 * Pure TypeScript: no database access, no server-only imports, so it can be
 * unit tested offline and imported from anywhere (client or server) later.
 *
 * IMPORTANT: these capabilities are DECLARED ONLY. Nothing in the application
 * reads this file yet, so no behaviour changes. A capability must only be
 * listed for a business type once its feature genuinely exists (schema,
 * service, UI, and agent tooling).
 */
import { BUSINESS_TYPES, type BusinessType } from "@/lib/business/constants";

/**
 * Domain capabilities a business type can have.
 * - `core` is always present: products, customers, orders, expenses, sales.
 */
export type BusinessCapability =
  | "core"
  | "fabric_attributes"
  | "serialized_inventory"
  | "warranty"
  | "repair_jobs"
  | "batch_expiry"
  | "recipes"
  | "kitchen_orders"
  | "bookings"
  | "bom_production"
  | "price_tiers_credit"
  | "custom_orders";

export type BusinessTypeConfig = {
  capabilities: readonly BusinessCapability[];
};

const CORE_ONLY: BusinessTypeConfig = { capabilities: ["core"] };

export const BUSINESS_TYPE_CONFIG: Record<BusinessType, BusinessTypeConfig> = {
  clothing_fashion: { capabilities: ["core", "fabric_attributes"] },
  restaurant_food: { capabilities: ["core", "recipes", "kitchen_orders"] },
  retail_shop: CORE_ONLY,
  grocery: CORE_ONLY,
  electronics: {
    capabilities: ["core", "serialized_inventory", "warranty", "repair_jobs"],
  },
  services: CORE_ONLY,
  other: CORE_ONLY,
};

const FALLBACK_TYPE: BusinessType = "other";

/** Unknown/invalid input falls back to "other" (same rule as lib/business/service.ts). */
function resolveType(type: unknown): BusinessType {
  return typeof type === "string" &&
    (BUSINESS_TYPES as readonly string[]).includes(type)
    ? (type as BusinessType)
    : FALLBACK_TYPE;
}

export function getBusinessCapabilities(
  type: unknown,
): readonly BusinessCapability[] {
  return BUSINESS_TYPE_CONFIG[resolveType(type)].capabilities;
}

export function hasCapability(
  type: unknown,
  capability: BusinessCapability,
): boolean {
  return getBusinessCapabilities(type).includes(capability);
}
