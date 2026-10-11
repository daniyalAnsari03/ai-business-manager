import { serviceState } from "./service-state.mjs";

function findCustomer(customerId) {
  return (serviceState.customers.data ?? []).find((c) => c.id === customerId) ?? null;
}

// Deterministic stand-ins for the customer service functions the audited tools
// call. A success applies the incoming values onto the stored record, so the
// audit snapshot reflects exactly the fields that really changed.
export async function getCustomers() {
  return serviceState.customers;
}

export async function createCustomer(input) {
  if (serviceState.createCustomerResult) return serviceState.createCustomerResult;
  return {
    ok: true,
    data: {
      id: "customer-new",
      businessId: "biz",
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

export async function updateCustomer(customerId, input) {
  if (serviceState.updateCustomerResult) return serviceState.updateCustomerResult;
  const customer = findCustomer(customerId);
  if (!customer) return { ok: false, reason: "not_found" };
  return { ok: true, data: { ...customer, ...input } };
}

export async function deleteCustomer(customerId) {
  if (serviceState.deleteCustomerResult) return serviceState.deleteCustomerResult;
  const customer = findCustomer(customerId);
  if (!customer) return { ok: false, reason: "not_found" };
  return { ok: true, data: { id: customer.id } };
}