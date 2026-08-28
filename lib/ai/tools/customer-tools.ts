import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";

import {
  findById,
  limitSchema,
  orKeep,
  resolveCustomer,
  toolClarify,
  toolFail,
  toolNeedsConfirmation,
  toolOk,
} from "@/lib/ai/tools/shared";
import {
  createCustomer,
  deleteCustomer,
  getCustomers,
  updateCustomer,
} from "@/lib/customers/service";
import { getOrdersByCustomer } from "@/lib/orders/service";
import type { CustomerWithStats } from "@/lib/customers/types";

/**
 * Customer tools — controlled wrappers over the customer service. Entity
 * references are resolved by name/phone within the caller's own business;
 * model-supplied ids are never trusted.
 */

function customerSummary(customer: CustomerWithStats) {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone ?? null,
    email: customer.email ?? null,
    address: customer.address ?? null,
    notes: customer.notes ?? null,
    totalOrders: customer.totalOrders,
    totalSpent: customer.totalSpent,
  };
}

async function loadCustomers(): Promise<CustomerWithStats[] | null> {
  const result = await getCustomers();
  return result.ok ? result.data : null;
}

/**
 * Resolves a customer from either an explicit ID (preferred — bypasses the
 * ambiguous name/phone search) or a name/phone query. The ID path lets the
 * agent act on the exact candidate it listed earlier (e.g. "pehla wala").
 */
async function resolveCustomerTarget(
  customers: CustomerWithStats[],
  params: { customerId?: string | null; query?: string },
): Promise<ReturnType<typeof resolveCustomer>> {
  if (params.customerId) {
    const byId = findById(customers, params.customerId);
    return byId ? { kind: "found", item: byId } : { kind: "not_found" };
  }
  return resolveCustomer(params.query ?? "", customers);
}

export const listCustomersTool = tool({
  name: "list_customers",
  description:
    "List saved customers with their order counts and spending. Optional search matches name, phone or email. Answers 'mere kitne customers hain?' and similar.",
  parameters: z.object({
    search: z.string().trim().max(120).optional().nullable(),
    limit: limitSchema(20, 50),
  }),
  execute: async ({ search, limit }) => {
    const result = await getCustomers(search ? { search } : {});
    if (!result.ok) {
      return toolFail(result.reason, "Could not read customers. Ask the user to try again.");
    }
    const customers = result.data;
    return toolOk({
      count: customers.length,
      truncated: customers.length > limit,
      customers: customers.slice(0, limit).map(customerSummary),
    });
  },
});

export const findCustomerTool = tool({
  name: "find_customer",
  description:
    "Find ONE specific customer by name or phone, e.g. 'Ahmed'. Returns their details and purchase history summary. When you have previously listed ambiguous candidates, you may pass customerId to target the exact one the user picked.",
  parameters: z.object({
    query: z.string().trim().min(1).max(160).optional().nullable(),
    customerId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact customer ID from a previous tool result when the user picked a specific candidate. Bypasses name search."),
  }),
  execute: async ({ query, customerId }) => {
    const customers = await loadCustomers();
    if (!customers) {
      return toolFail("database_error", "Could not read customers. Ask the user to try again.");
    }
    const match = await resolveCustomerTarget(customers, { customerId, query: query ?? undefined });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such customer. Tell the user honestly; offer to add them.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(customerSummary),
        hint: "Several customers match. Ask the user which one they mean.",
      });
    }
    return toolOk({ customer: customerSummary(match.item) });
  },
});

export const getCustomerOrdersTool = tool({
  name: "get_customer_orders",
  description:
    "One saved customer's full order history (newest first): order numbers, status, items with quantities and prices, and totals. Use for 'Ali ka order history batao' / 'Ali ne kya kya khareeda?'.",
  parameters: z.object({
    customerName: z.string().trim().min(1).max(160).optional().nullable(),
    customerId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact customer ID from a previous tool result when the user picked a specific candidate. Bypasses name search."),
    limit: limitSchema(10, 20),
  }),
  execute: async ({ customerName, customerId, limit }) => {
    const customers = await loadCustomers();
    if (!customers) {
      return toolFail("database_error", "Could not read customers. Ask the user to try again.");
    }
    const match = await resolveCustomerTarget(customers, { customerId, query: customerName ?? undefined });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such customer. Tell the user honestly; offer to add them.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(customerSummary),
        hint: "Several customers match. Ask the user which one they mean.",
      });
    }
    const target = match.item;
    const orders = await getOrdersByCustomer(target.id, limit);
    if (!orders.ok) {
      return toolFail(orders.reason, "Could not read orders. Ask the user to try again.");
    }
    return toolOk({
      customer: { name: target.name, phone: target.phone ?? null },
      totalOrdersOnRecord: target.totalOrders,
      totalSpent: target.totalSpent,
      count: orders.data.length,
      orders: orders.data.map((order) => ({
        orderNumber: order.orderNumber,
        status: order.status,
        orderedAt: order.orderedAt,
        total: order.total,
        items: order.items.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      })),
    });
  },
});

export const createCustomerTool = tool({
  name: "create_customer",
  description:
    "Save a new customer. A name is required; phone/email/address/notes are optional. Never invent details the user did not give.",
  parameters: z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(30).optional().nullable(),
    email: z.string().trim().max(200).optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  }),
  execute: async (input) => {
    // Follow-up safety: when a user adds a customer and then, in a later turn,
    // provides the rest of the details ("us ka phone/email/address ...") the
    // model often calls create_customer again instead of update_customer,
    // silently creating a duplicate record with the same name. If a customer
    // with the SAME name already exists in this business, update that record
    // with any provided fields instead of creating a duplicate — the user's
    // intent is almost always to complete the existing customer's profile.
    const customers = await loadCustomers();
    if (customers) {
      const needle = input.name.trim().toLowerCase();
      const sameName = customers.filter((c) => c.name.trim().toLowerCase() === needle);
      if (sameName.length === 1) {
        const existing = sameName[0];
        const merged = {
          name: existing.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          notes: input.notes ?? null,
        };
        const updateResult = await updateCustomer(existing.id, merged);
        if (updateResult.ok) {
          console.log(
            "[customer-tools] create_customer -> existing same-name customer found; UPDATED instead of duplicated:",
            existing.id,
          );
          return toolOk({
            updated_existing: true,
            customer: customerSummary({
              ...updateResult.data,
              totalOrders: existing.totalOrders,
              totalSpent: existing.totalSpent,
            }),
          });
        }
        // If the update failed, fall through to a normal create attempt.
      }
    }

    const result = await createCustomer(input);
    if (!result.ok) {
      return toolFail(
        result.reason,
        result.reason === "invalid_input"
          ? "Invalid customer details (e.g. bad email). Correct them and retry."
          : "Could not save the customer. Do not claim success.",
      );
    }
    return toolOk({ created: true, customer: customerSummary({ ...result.data, totalOrders: 0, totalSpent: 0 }) });
  },
});

export const updateCustomerTool = tool({
  name: "update_customer",
  description:
    "Update an existing customer's details. Only include the fields that should change; other fields stay as they are.",
  parameters: z.object({
    customerName: z.string().trim().min(1).max(160).optional().nullable(),
    customerId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact customer ID from a previous tool result when the user picked a specific candidate. Bypasses name search."),
    name: z.string().trim().min(1).max(120).optional().nullable(),
    phone: z.string().trim().max(30).optional().nullable(),
    email: z.string().trim().max(200).optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  }),
  execute: async ({ customerName, customerId, ...changes }) => {
    const customers = await loadCustomers();
    if (!customers) {
      return toolFail("database_error", "Could not read customers. Ask the user to try again.");
    }
    const match = await resolveCustomerTarget(customers, { customerId, query: customerName ?? undefined });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such customer. Tell the user honestly.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(customerSummary),
        hint: "Ask the user which customer they mean.",
      });
    }

    // Merge onto the stored record so unspecified fields are preserved. The
    // model often sends `null` for fields it isn't changing (e.g. email:null
    // when only the phone changed); orKeep treats null as "leave unchanged" so
    // updating one field never wipes the others.
    const current = match.item;
    const merged = {
      name: orKeep(changes.name, current.name),
      phone: orKeep(changes.phone, current.phone),
      email: orKeep(changes.email, current.email),
      address: orKeep(changes.address, current.address),
      notes: orKeep(changes.notes, current.notes),
    };

    const result = await updateCustomer(current.id, merged);
    if (!result.ok) {
      return toolFail(
        result.reason,
        result.reason === "invalid_input"
          ? "Invalid customer details (e.g. bad email). Correct them and retry."
          : "Update failed. Do not claim success.",
      );
    }
    return toolOk({
      updated: true,
      customer: customerSummary({
        ...current,
        ...merged,
      }),
    });
  },
});

export const deleteCustomerTool = tool({
  name: "delete_customer",
  description:
    "Delete a saved customer (their past orders are kept but unlinked). DESTRUCTIVE: requires the user's explicit confirmation in a previous turn before confirmed=true may be used. When the user picked a specific candidate from an earlier list, pass customerId to delete exactly that one; otherwise pass the customerName.",
  parameters: z.object({
    customerName: z.string().trim().min(1).max(160).optional().nullable(),
    customerId: z.string().trim().min(1).max(60).optional().nullable().describe("Exact customer ID from a previous tool result when the user picked a specific candidate. Bypasses name search."),
    confirmed: z.boolean().default(false),
  }),
  execute: async ({ customerName, customerId, confirmed }) => {
    const customers = await loadCustomers();
    if (!customers) {
      return toolFail("database_error", "Could not read customers. Ask the user to try again.");
    }
    const match = await resolveCustomerTarget(customers, { customerId, query: customerName ?? undefined });
    if (match.kind === "not_found") {
      return toolFail("not_found", "No such customer. Tell the user honestly.");
    }
    if (match.kind === "ambiguous") {
      return toolClarify({
        multiple_matches: true,
        candidates: match.candidates.map(customerSummary),
        hint: "Ask the user which customer they mean.",
      });
    }
    const target = match.item;
    if (!confirmed) {
      return toolNeedsConfirmation(
        `Delete customer "${target.name}"${target.phone ? ` (${target.phone})` : ""}`,
        `Kya aap sach mein customer "${target.name}" ko delete karna chahte hain?`,
        `Kya aap sach mein customer "${target.name}" ko delete karna chahte hain?`,
      );
    }
    const result = await deleteCustomer(target.id);
    if (!result.ok) {
      return toolFail(result.reason, "Deletion failed. Do not claim success.");
    }
    return toolOk({ removed: true, name: target.name });
  },
});
