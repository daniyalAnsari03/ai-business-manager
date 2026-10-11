import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import {
  findById,
  limitSchema,
  readAgentContext,
  resolveSupplier,
  toolClarify,
  toolFail,
  toolOk,
} from "@/lib/ai/tools/shared";
import { recordAgentAudit } from "@/lib/audit/write-audit-log";
import {
  createSupplierBill,
  getSupplierBills,
} from "@/lib/supplier-bills/service";
import type { SupplierBillStatus, SupplierBillWithDetails } from "@/lib/supplier-bills/types";
import { getSuppliers } from "@/lib/suppliers/service";
import type { SupplierWithOwing } from "@/lib/suppliers/types";

/**
 * Supplier-bill tools. A bill is amount-only (it never touches stock). Bills
 * are written through the supplier-bill service, which calls the controlled
 * `create_supplier_bill` RPC server-side.
 */

const BILL_STATUSES = ["unpaid", "partial", "paid"] as const;

function billSummary(bill: SupplierBillWithDetails) {
  return {
    id: bill.id,
    supplierId: bill.supplierId,
    supplierName: bill.supplierName,
    billNumber: bill.billNumber,
    billDate: bill.billDate,
    dueDate: bill.dueDate,
    total: bill.total,
    paidAmount: bill.paidAmount,
    dueAmount: bill.dueAmount,
    status: bill.status,
  };
}

async function loadSuppliers(): Promise<SupplierWithOwing[] | null> {
  const result = await getSuppliers();
  return result.ok ? result.data : null;
}

export const listSupplierBillsTool = tool({
  name: "list_supplier_bills",
  description:
    "List supplier bills (what the business owes suppliers), newest first, with total, paid and due amounts and status. Optionally filter by supplier name or status. Answers 'kis bill ki kitni payment baqi hai?'.",
  parameters: z.object({
    supplierName: z.string().trim().max(160).optional().nullable(),
    supplierId: z.string().trim().max(60).optional().nullable().describe("Exact supplier id from a previous tool result."),
    status: z.enum(BILL_STATUSES).optional().nullable().describe("Filter by bill status."),
    search: z.string().trim().max(120).optional().nullable(),
    limit: limitSchema(20, 50),
  }),
  execute: async ({ supplierName, supplierId, status, search, limit }) => {
    let resolvedSupplierId = supplierId ?? undefined;
    if (!resolvedSupplierId && supplierName) {
      const suppliers = await loadSuppliers();
      if (!suppliers) {
        return toolFail("database_error", "Could not read suppliers. Ask the user to try again.");
      }
      const byId = supplierId ? findById(suppliers, supplierId) : null;
      const match = byId ? { kind: "found" as const, item: byId } : resolveSupplier(supplierName, suppliers);
      if (match.kind === "not_found") {
        return toolFail("not_found", "No such supplier. Tell the user honestly.");
      }
      if (match.kind === "ambiguous") {
        return toolClarify({
          multiple_matches: true,
          candidates: match.candidates.map((s) => ({ id: s.id, name: s.name })),
          hint: "Several suppliers match. Ask the user which one they mean.",
        });
      }
      resolvedSupplierId = match.item.id;
    }

    const result = await getSupplierBills({
      supplierId: resolvedSupplierId,
      status: status as SupplierBillStatus | undefined,
      search: search ?? undefined,
    });
    if (!result.ok) {
      return toolFail(result.reason, "Could not read supplier bills. Ask the user to try again.");
    }
    const bills = result.data;
    return toolOk({
      count: bills.length,
      truncated: bills.length > limit,
      totalDue: bills.reduce((sum, bill) => sum + bill.dueAmount, 0),
      bills: bills.slice(0, limit).map(billSummary),
    });
  },
});

export const createSupplierBillTool = tool({
  name: "create_supplier_bill",
  description:
    "Record a new supplier bill (amount only). Requires the supplier and the bill subtotal; discount, bill number, bill date, due date and notes are optional. Never invent amounts the user did not give.",
  parameters: z.object({
    supplierName: z.string().trim().max(160).optional().nullable(),
    supplierId: z.string().trim().max(60).optional().nullable().describe("Exact supplier id from a previous tool result."),
    subtotal: z.number().positive().describe("Bill amount before discount."),
    discount: z.number().min(0).optional().nullable(),
    billNumber: z.string().trim().max(60).optional().nullable(),
    billDate: z.string().trim().max(20).optional().nullable().describe("ISO date YYYY-MM-DD; defaults to today."),
    dueDate: z.string().trim().max(20).optional().nullable().describe("ISO date YYYY-MM-DD, or omit if no due date."),
    notes: z.string().trim().max(1000).optional().nullable(),
  }),
  execute: async (input, ctx) => {
    const suppliers = await loadSuppliers();
    if (!suppliers) {
      return toolFail("database_error", "Could not read suppliers. Ask the user to try again.");
    }
    const byId = input.supplierId ? findById(suppliers, input.supplierId) : null;
    const match = byId
      ? { kind: "found" as const, item: byId }
      : input.supplierName
        ? resolveSupplier(input.supplierName, suppliers)
        : { kind: "not_found" as const };
    if (match.kind === "not_found") {
      return toolFail(
        "not_found",
        input.supplierName || input.supplierId
          ? "No such supplier. Tell the user honestly; offer to add the supplier first."
          : "Which supplier is this bill for? Ask the user for the supplier name.",
      );
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map((s) => ({ id: s.id, name: s.name })),
        hint: "Several suppliers match. Ask the user which one they mean.",
      });
    }
    const supplier = match.item;

    const result = await createSupplierBill({
      supplierId: supplier.id,
      subtotal: input.subtotal,
      discount: input.discount ?? 0,
      billNumber: input.billNumber ?? null,
      billDate: input.billDate ?? null,
      dueDate: input.dueDate ?? null,
      notes: input.notes ?? null,
    });
    if (!result.ok) {
      const hint =
        result.reason === "invalid_input"
          ? "Some bill details are invalid. Ask the user to correct them."
          : result.reason === "not_found"
            ? "The supplier could not be found. It may have been deleted."
            : "The bill could not be saved. Do not claim success.";
      return toolFail(result.reason, hint);
    }

    await recordAgentAudit(readAgentContext(ctx), {
      action: "supplier_bill.create",
      entity: "supplier_bill",
      entityId: result.data.id,
      after: {
        id: result.data.id,
        supplierId: result.data.supplierId,
        total: result.data.total,
        dueAmount: result.data.dueAmount,
      },
    });
    return toolOk({
      created: true,
      bill: {
        id: result.data.id,
        supplierName: supplier.name,
        billNumber: result.data.billNumber,
        billDate: result.data.billDate,
        dueDate: result.data.dueDate,
        total: result.data.total,
        paidAmount: result.data.paidAmount,
        dueAmount: result.data.dueAmount,
        status: result.data.status,
      },
    });
  },
});
