import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/server";
import type { PaymentServiceError } from "@/lib/payments/service";

/**
 * Service-role access to the money writers (`record_payment_for_business` /
 * `reverse_payment_for_business`).
 *
 * These functions EXIST ONLY for the approval executor: when an approved
 * WhatsApp action executes, there is no browser session, so the server must be
 * able to record money deterministically. The internal RPCs take a
 * business_id on purpose, and the RPC re-proves every claim against that
 * business inside a locked transaction.
 *
 * SECURITY CONTRACT (do not break):
 *  - `businessId` comes ONLY from a server-verified business context (e.g. the
 *    `AgentRunContext.business` resolved from the session when the approval was
 *    created, or `context.business` in the executor). NEVER from a client,
 *    model output or unverified payload.
 *  - `idempotencyKey` MUST be stable per real-world action (the approval
 *    action id) so a retried approval replays instead of recording money twice.
 *  - These functions are NOT exported for use inside business screen flows;
 *    those go through `lib/payments/service.ts` (authenticated wrappers).
 */

export type ServiceRolePaymentResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: PaymentServiceError };

function mapRpcError(code: string | null | undefined): PaymentServiceError {
  switch (code) {
    case "NO_BUSINESS":
      return "no_business";
    case "NOT_FOUND":
      return "not_found";
    case "ACTOR_REQUIRED":
      return "actor_required";
    case "IDEMPOTENCY_KEY_REQUIRED":
      return "idempotency_key_required";
    case "IDEMPOTENCY_CONFLICT":
      return "idempotency_conflict";
    case "INVALID_REASON":
      return "invalid_reason";
    case "INVALID_AMOUNT":
      return "invalid_amount";
    case "INVALID_METHOD":
      return "invalid_method";
    case "INVALID_REFERENCE":
      return "invalid_reference";
    case "INVALID_NOTES":
      return "invalid_notes";
    case "ORDER_INVALID":
      return "order_invalid";
    case "BILL_INVALID":
      return "bill_invalid";
    case "TARGET_REQUIRED":
      return "target_required";
    case "TARGET_AMBIGUOUS":
      return "target_ambiguous";
    case "ORDER_CANCELLED":
      return "order_cancelled";
    case "NO_DUE":
      return "no_due";
    case "OVERPAYMENT":
      return "overpayment";
    case "NOT_REVERSIBLE":
      return "not_reversible";
    case "ALREADY_REVERSED":
      return "already_reversed";
    case "NEGATIVE_PAID":
      return "negative_paid";
    default:
      return "database_error";
  }
}

interface RpcBody {
  ok?: boolean;
  error?: string;
}

function readRpc<R extends RpcBody>(result: {
  data: unknown;
  error: unknown;
}): ServiceRolePaymentResult<R> {
  if (result.error) return { ok: false, reason: "database_error" };
  const body = result.data as R | null;
  if (!body) return { ok: false, reason: "database_error" };
  if (body.ok === false) return { ok: false, reason: mapRpcError(body.error) };
  return { ok: true, data: body };
}

export interface RecordPaymentForBusinessArgs {
  /** Server-verified business id. See the security contract above. */
  businessId: string;
  /** The acting owner (action requester). */
  actorId: string;
  payload: Record<string, unknown>;
}

export interface ReversePaymentForBusinessArgs {
  /** Server-verified business id. See the security contract above. */
  businessId: string;
  /** The acting owner (action requester). */
  actorId: string;
  paymentId: string;
  reason: string;
  idempotencyKey: string;
}

export async function recordPaymentForBusinessServiceRole(
  args: RecordPaymentForBusinessArgs,
): Promise<ServiceRolePaymentResult<{ ok: true } & RpcBody & Record<string, unknown>>> {
  const admin = await getSupabaseAdminClient();
  if (!admin) return { ok: false, reason: "database_error" };

  const { data, error } = await admin.rpc("record_payment_for_business", {
    p_business_id: args.businessId,
    p_actor: args.actorId,
    p_payload: args.payload,
  });
  return readRpc<{ ok: true } & RpcBody & Record<string, unknown>>({ data, error });
}

export async function reversePaymentForBusinessServiceRole(
  args: ReversePaymentForBusinessArgs,
): Promise<ServiceRolePaymentResult<{ ok: true } & RpcBody & Record<string, unknown>>> {
  const admin = await getSupabaseAdminClient();
  if (!admin) return { ok: false, reason: "database_error" };

  const { data, error } = await admin.rpc("reverse_payment_for_business", {
    p_business_id: args.businessId,
    p_actor: args.actorId,
    p_payment_id: args.paymentId,
    p_reason: args.reason,
    p_idempotency_key: args.idempotencyKey,
  });
  return readRpc<{ ok: true } & RpcBody & Record<string, unknown>>({ data, error });
}