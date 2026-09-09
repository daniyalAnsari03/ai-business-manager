import "server-only";

import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { getWhatsAppProvider } from "@/lib/marketing/whatsapp/provider";
import { verifyHubSignature } from "@/lib/marketing/whatsapp/signature";
import { processInboundReply } from "@/lib/marketing/whatsapp/whatsapp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WhatsApp Cloud API webhook.
 *
 * GET  — subscription verification (echoes the challenge when the verify
 *        token matches, so the provider/agent confirms the webhook URL).
 * POST — inbound message handling. The signature is verified against the raw
 *        body + app secret BEFORE the payload is trusted. Replies that
 *        approve/reject a pending action are mapped through the approval
 *        engine (owner phone + external_reference checks, idempotent).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode") ?? "";
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";

  const provider = getWhatsAppProvider();
  if (!provider) {
    return new NextResponse("WhatsApp not configured", { status: 200 });
  }

  const verified = provider.verifyWebhook(mode, token, challenge);
  if (!verified.ok || !verified.challenge) {
    return new NextResponse("Verification failed", { status: 403 });
  }
  return new NextResponse(verified.challenge, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.arrayBuffer();
  const rawBuffer = Buffer.from(raw);

  // Verify signature before trusting the payload.
  const signature = request.headers.get("x-hub-signature-256");
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!verifyHubSignature(signature, rawBuffer, appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBuffer.toString("utf8"));
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  // Only handle text messages that carry a reply.
  const provider = getWhatsAppProvider();
  if (!provider) {
    return new NextResponse("WhatsApp not configured", { status: 200 });
  }

  const messages = await provider.parseInboundWebhook(body);
  if (!messages) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  for (const message of messages) {
    // Never block on a single reply; log + continue.
    const result = await processInboundReply({
      from: message.from,
      body: message.body,
      providerMessageId: message.providerMessageId,
    });

    if (!result.ok) {
      switch (result.reason) {
        case "ambiguous": {
          // Ask for a clearer YES / NO (honest — we never guess).
          await sendClarification(message.from);
          break;
        }
        case "duplicate":
        case "unauthorized":
        case "not_found":
        default:
          // Silently ignore (do not leak details to an unauthenticated caller).
          break;
      }
    }
  }

  // Also handle status updates (delivery/read receipts) from Meta.
  // Fire-and-forget: never block the webhook response on persistence.
  handleStatusUpdates(body).catch((err) => {
    console.error("[WhatsApp Status] Failed to persist status updates:", err);
  });

  // Always acknowledge the webhook with 200 within Meta's timeout.
  return new NextResponse("OK", { status: 200 });
}

/**
 * Processes outbound message status updates (sent/delivered/read/failed)
 * from Meta's webhook and persists them idempotently.
 *
 * Status webhooks do NOT carry business context, so we resolve ownership via
 * the whatsapp_message_id_map table (populated at send time). Duplicate
 * webhooks from Meta retries are handled by the unique constraint on
 * message_id — the upsert only advances status forward.
 */
async function handleStatusUpdates(body: unknown): Promise<void> {
  try {
    const payload = body as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            statuses?: Array<{
              id?: string;
              status?: string;
              timestamp?: string;
              recipient_id?: string;
              errors?: Array<{ code?: number; message?: string; error_data?: { troubleshooting_url?: string } }>;
            }>;
          };
        }>;
      }>;
    };

    const statuses = payload?.entry?.[0]?.changes?.[0]?.value?.statuses;
    if (!Array.isArray(statuses) || statuses.length === 0) return;

    const admin = await getSupabaseAdminClient();
    if (!admin) {
      console.warn("[WhatsApp Status] No admin client — cannot persist status updates");
      return;
    }

    for (const status of statuses) {
      const msgId = status.id ?? "unknown";
      const state = status.status ?? "unknown";
      const ts = status.timestamp ?? "";
      const recipient = status.recipient_id ?? "";

      // Log for observability.
      console.log(
        `[WhatsApp Status] message=${msgId} status=${state} recipient=${recipient} time=${ts}`,
        status.errors ? { errors: status.errors } : "",
      );

      // Resolve business from the message ID map.
      const { data: mapping } = await admin
        .from("whatsapp_message_id_map")
        .select("business_id, recipient_phone")
        .eq("provider_message_id", msgId)
        .maybeSingle();

      if (!mapping) {
        // Message was sent outside our system or map row not yet committed.
        console.log(`[WhatsApp Status] No business mapping for message ${msgId} — skipping persistence`);
        continue;
      }

      const businessId = mapping.business_id as string;
      const recipientPhone = (mapping.recipient_phone as string) || recipient;

      // Parse Meta timestamp (unix seconds) to ISO.
      const providerTimestamp = ts && /^\d+$/.test(ts)
        ? new Date(Number.parseInt(ts, 10) * 1000).toISOString()
        : null;

      // Idempotent upsert: only advance status forward.
      // sent < delivered < read; failed is terminal.
      const { data: existing } = await admin
        .from("whatsapp_message_status")
        .select("status")
        .eq("message_id", msgId)
        .maybeSingle();

      const existingStatus = existing?.status as string | undefined;
      const shouldUpdate = !existingStatus || shouldAdvanceStatus(existingStatus, state);

      if (shouldUpdate) {
        const upsertPayload = {
          business_id: businessId,
          message_id: msgId,
          recipient_phone: recipientPhone,
          status: state,
          provider_timestamp: providerTimestamp,
          errors: status.errors ?? null,
        };

        const { error } = await admin
          .from("whatsapp_message_status")
          .upsert(upsertPayload, { onConflict: "message_id" });

        if (error) {
          console.error(`[WhatsApp Status] Failed to persist status for ${msgId}:`, error.message);
        }
      }
    }
  } catch {
    // Status updates are informational; never crash the webhook.
  }
}

/** Returns true if `newStatus` represents a forward progression from `currentStatus`. */
function shouldAdvanceStatus(currentStatus: string, newStatus: string): boolean {
  const order: Record<string, number> = { sent: 0, delivered: 1, read: 2, failed: 3 };
  const current = order[currentStatus] ?? -1;
  const next = order[newStatus] ?? -1;
  // Allow transition to 'failed' from any state, or forward progression.
  return newStatus === "failed" || next > current;
}

/** Sends a short clarification request when intent cannot be determined. */
async function sendClarification(to: string): Promise<void> {
  const provider = getWhatsAppProvider();
  if (!provider) return;
  try {
    await provider.sendText({
      businessId: "",
      to,
      text: "Please reply with a clear YES or NO only.",
    });
  } catch {
    // Best-effort clarification; never crash the webhook.
  }
}
