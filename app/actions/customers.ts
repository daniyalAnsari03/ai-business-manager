"use server";

import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  getCustomers,
  updateCustomer,
  type CustomerServiceError,
} from "@/lib/customers/service";
import type { Customer, CustomerWithStats } from "@/lib/customers/types";

export type CustomerActionState =
  | { ok: true; customer: Customer }
  | { ok: false; reason: CustomerServiceError };

export type CustomerListActionState =
  | { ok: true; customers: CustomerWithStats[] }
  | { ok: false; reason: CustomerServiceError };

/**
 * Thin server-action boundary over the customer service. Inputs stay
 * `unknown` on purpose — validation and ownership happen inside the
 * service, never in the browser.
 */

export async function createCustomerAction(
  input: unknown,
): Promise<CustomerActionState> {
  const result = await createCustomer(input);
  return result.ok
    ? { ok: true, customer: result.data }
    : { ok: false, reason: result.reason };
}

export async function updateCustomerAction(
  customerId: string,
  input: unknown,
): Promise<CustomerActionState> {
  const result = await updateCustomer(customerId, input);
  return result.ok
    ? { ok: true, customer: result.data }
    : { ok: false, reason: result.reason };
}

export async function deleteCustomerAction(
  customerId: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: CustomerServiceError }> {
  const result = await deleteCustomer(customerId);
  return result.ok
    ? { ok: true, id: result.data.id }
    : { ok: false, reason: result.reason };
}

export async function getCustomersAction(
  options: Parameters<typeof getCustomers>[0] = {},
): Promise<CustomerListActionState> {
  const result = await getCustomers(options);
  return result.ok
    ? { ok: true, customers: result.data }
    : { ok: false, reason: result.reason };
}

export async function getCustomerAction(
  customerId: string,
): Promise<CustomerActionState> {
  const result = await getCustomer(customerId);
  return result.ok
    ? { ok: true, customer: result.data }
    : { ok: false, reason: result.reason };
}
