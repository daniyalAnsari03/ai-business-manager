import "server-only";

import { NextResponse } from "next/server";

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

  // Always acknowledge the webhook with 200 within Meta's timeout.
  return new NextResponse("OK", { status: 200 });
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
