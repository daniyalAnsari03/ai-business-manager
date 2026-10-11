import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import {
  findById,
  limitSchema,
  orKeep,
  readAgentContext,
  resolveSupplier,
  toolClarify,
  toolFail,
  toolNeedsConfirmation,
  toolOk,
} from "@/lib/ai/tools/shared";
import { recordAgentAudit } from "@/lib/audit/write-audit-log";
import {
  createSupplier,
  deleteSupplier,
  getSuppliers,
  updateSupplier,
} from "@/lib/suppliers/service";
import type { Supplier, SupplierWithOwing } from "@/lib/suppliers/types";

/**
 * Supplier tools — controlled wrappers over the supplier service. Entity
 * references are resolved by name/phone within the caller's own business;
 * model-supplied ids are never trusted (they are only ever re-checked against
 * the caller's own list, so a guessed/foreign id resolves to null).
 */

function supplierSummary(supplier: SupplierWithOwing) {
  return {
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone ?? null,
    email: supplier.email ?? null,
    address: supplier.address ?? null,
    paymentTerms: supplier.paymentTerms ?? null,
    notes: supplier.notes ?? null,
    totalOwing: supplier.totalOwing,
  };
}

async function loadSuppliers(): Promise<SupplierWithOwing[] | null> {
  const result = await getSuppliers();
  return result.ok ? result.data : null;
}

/**
 * Supplier fields whose VALUES must never be written to history (contact /
 * free-text personal data). A change to any of these is recorded only as a
 * field NAME in `changed_fields`, never the value.
 */
const SUPPLIER_PRIVATE_FIELDS = [
  "phone",
  "email",
  "address",
  "paymentTerms",
  "notes",
] as const;

type SupplierHistoryFields = Pick<
  Supplier,
  "name" | "phone" | "email" | "address" | "paymentTerms" | "notes"
>;

function supplierChangeAudit(
  previous: SupplierHistoryFields,
  next: SupplierHistoryFields,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  if (next.name !== previous.name) {
    before.name = previous.name;
    after.name = next.name;
  }
  const privateChanged = SUPPLIER_PRIVATE_FIELDS.filter(
    (field) => (next[field] ?? null) !== (previous[field] ?? null),
  );
  if (privateChanged.length > 0) {
    before.changed_fields = [...privateChanged];
    after.changed_fields = [...privateChanged];
  }
  return Object.keys(after).length > 0 ? { before, after } : null;
}

async function resolveSupplierTarget(
  suppliers: SupplierWithOwing[],
  params: { supplierId?: string | null; query?: string },
): Promise<ReturnType<typeof resolveSupplier>> {
  if (params.supplierId) {
    const byId = findById(suppliers, params.supplierId);
    return byId ? { kind: "found", item: byId } : { kind: "not_found" };
  }
  return resolveSupplier(params.query ?? "", suppliers);
}

export const listSuppliersTool = tool({
  name: "list_suppliers",
  description:
    "List saved suppliers with how much the business currently owes each one. Optional search matches name, phone or email. Answers 'mere kitne suppliers hain?' / 'kis supplier ko kitna dena hai?'.",
  parameters: z.object({
    search: z.string().trim().max(120).optional().nullable(),
    limit: limitSchema(20, 50),
  }),
  execute: async ({ search, limit }) => {
    const result = await getSuppliers(search ? { search } : {});
    if (!result.ok) {
      return toolFail(result.reason, "Could not read suppliers. Ask the user to try again.");
    }
    const suppliers = result.data;
    return toolOk({
      count: suppliers.length,
      truncated: suppliers.length > limit,
      suppliers: suppliers.slice(0, limit).map(supplierSummary),
    });
  },
});

export const findSupplierTool = tool({
  name: "find_supplier",
  description:
    "Find one supplier by name/phone/email and show how much the business owes them. Use supplierId when the user picked a specific candidate from an earlier list.",
  parameters: z.object({
    supplierName: z.string().trim().min(1).max(160).optional().nullable(),
    supplierId: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .nullable()
      .describe("Exact supplier ID from a previous tool result when the user picked a specific candidate. Bypasses name search."),
  }),
  execute: async ({ supplierName, supplierId }) => {
    const suppliers = await loadSuppliers();
    if (!suppliers) {
      return toolFail("database_error", "Could not read suppliers. Ask the user to try again.");
    }
    const match = await resolveSupplierTarget(suppliers, {
      supplierId,
      query: supplierName ?? undefined,
    });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such supplier. Tell the user honestly; offer to add them.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(supplierSummary),
        hint: "Several suppliers match. Ask the user which one they mean.",
      });
    }
    return toolOk({ supplier: supplierSummary(match.item) });
  },
});

export const createSupplierTool = tool({
  name: "create_supplier",
  description:
    "Save a new supplier. A name is required; phone/email/address/payment terms/notes are optional. Never invent details the user did not give.",
  parameters: z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(30).optional().nullable(),
    email: z.string().trim().max(200).optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    paymentTerms: z.string().trim().max(120).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  }),
  execute: async (input, ctx) => {
    const result = await createSupplier({
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      paymentTerms: input.paymentTerms ?? null,
      notes: input.notes ?? null,
    });
    if (!result.ok) {
      const hint =
        result.reason === "supplier_exists"
          ? "A supplier with this name already exists. Offer to update that one instead."
          : result.reason === "invalid_input"
            ? "Some details are invalid. Ask the user to correct them."
            : "The supplier could not be saved. Do not claim success.";
      return toolFail(result.reason, hint);
    }
    await recordAgentAudit(readAgentContext(ctx), {
      action: "supplier.create",
      entity: "supplier",
      entityId: result.data.id,
      after: { id: result.data.id, name: result.data.name },
    });
    return toolOk({
      created: true,
      supplier: supplierSummary({ ...result.data, totalOwing: 0 }),
    });
  },
});

export const updateSupplierTool = tool({
  name: "update_supplier",
  description:
    "Update an existing supplier's details. Only include the fields that should change; other fields stay as they are.",
  parameters: z.object({
    supplierName: z.string().trim().min(1).max(160).optional().nullable(),
    supplierId: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .nullable()
      .describe("Exact supplier ID from a previous tool result when the user picked a specific candidate. Bypasses name search."),
    name: z.string().trim().min(1).max(120).optional().nullable(),
    phone: z.string().trim().max(30).optional().nullable(),
    email: z.string().trim().max(200).optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    paymentTerms: z.string().trim().max(120).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  }),
  execute: async ({ supplierName, supplierId, ...changes }, ctx) => {
    const suppliers = await loadSuppliers();
    if (!suppliers) {
      return toolFail("database_error", "Could not read suppliers. Ask the user to try again.");
    }
    const match = await resolveSupplierTarget(suppliers, {
      supplierId,
      query: supplierName ?? undefined,
    });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such supplier. Tell the user honestly.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(supplierSummary),
        hint: "Several suppliers match. Ask the user which one they mean.",
      });
    }
    const target = match.item;
    const merged = {
      name: orKeep(changes.name, target.name),
      phone: orKeep(changes.phone, target.phone),
      email: orKeep(changes.email, target.email),
      address: orKeep(changes.address, target.address),
      paymentTerms: orKeep(changes.paymentTerms, target.paymentTerms),
      notes: orKeep(changes.notes, target.notes),
    };
    const result = await updateSupplier(target.id, merged);
    if (!result.ok) {
      const hint =
        result.reason === "supplier_exists"
          ? "Another supplier already uses this name. Ask the user for a different one."
          : "The supplier could not be updated. Do not claim success.";
      return toolFail(result.reason, hint);
    }
    const change = supplierChangeAudit(target, result.data);
    if (change) {
      await recordAgentAudit(readAgentContext(ctx), {
        action: "supplier.update",
        entity: "supplier",
        entityId: target.id,
        before: change.before,
        after: change.after,
      });
    }
    return toolOk({
      updated: true,
      supplier: supplierSummary({ ...result.data, totalOwing: target.totalOwing }),
    });
  },
});

export const deleteSupplierTool = tool({
  name: "delete_supplier",
  description:
    "Delete a saved supplier. DESTRUCTIVE: requires the user's explicit confirmation in a previous turn before confirmed=true may be used. A supplier that already has bills cannot be deleted — say so honestly.",
  parameters: z.object({
    supplierName: z.string().trim().min(1).max(160).optional().nullable(),
    supplierId: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .nullable()
      .describe("Exact supplier ID from a previous tool result when the user picked a specific candidate. Bypasses name search."),
    confirmed: z.boolean().default(false),
  }),
  execute: async ({ supplierName, supplierId, confirmed }, ctx) => {
    const suppliers = await loadSuppliers();
    if (!suppliers) {
      return toolFail("database_error", "Could not read suppliers. Ask the user to try again.");
    }
    const match = await resolveSupplierTarget(suppliers, {
      supplierId,
      query: supplierName ?? undefined,
    });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such supplier. Tell the user honestly.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(supplierSummary),
        hint: "Several suppliers match. Ask the user which one they mean.",
      });
    }
    const target = match.item;
    if (!confirmed) {
      return toolNeedsConfirmation(
        `Delete supplier "${target.name}"${target.phone ? ` (${target.phone})` : ""}`,
        `Kya aap sach mein supplier "${target.name}" ko delete karna chahte hain?`,
        `Kya aap sach mein supplier "${target.name}" ko delete karna chahte hain?`,
      );
    }
    const result = await deleteSupplier(target.id);
    if (!result.ok) {
      const hint =
        result.reason === "supplier_has_bills"
          ? "This supplier has bills and cannot be deleted. Tell the user to remove/cancel the bills first."
          : "Deletion failed. Do not claim success.";
      return toolFail(result.reason, hint);
    }
    await recordAgentAudit(readAgentContext(ctx), {
      action: "supplier.delete",
      entity: "supplier",
      entityId: target.id,
      before: { id: target.id, name: target.name },
    });
    return toolOk({ removed: true, name: target.name });
  },
});
