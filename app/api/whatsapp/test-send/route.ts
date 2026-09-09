import "server-only";

import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { getWhatsAppProvider } from "@/lib/marketing/whatsapp/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Test endpoint: sends a real WhatsApp message via Cloud API.
 * Uses the same provider logic but bypasses the business/approval layer.
 *
 * POST /api/whatsapp/test-send
 * Body: { "to": "923001234567", "businessId"?: "uuid" }
 *
 * Only works when WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID are set.
 * The recipient MUST be an approved test recipient in the Meta dashboard.
 *
 * When businessId is provided, the provider message ID is persisted to
 * whatsapp_message_id_map so that Meta status webhooks can resolve business
 * ownership and be persisted to whatsapp_message_status.
 *
 * Requires x-cron-secret header matching CRON_SECRET env var.
 */

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET ?? process.env.CRON_AUTH_TOKEN;
  const provided = request.headers.get("x-cron-secret");
  if (expected && provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const provider = getWhatsAppProvider();
  if (!provider) {
    return NextResponse.json(
      { error: "WhatsApp credentials not configured" },
      { status: 503 },
    );
  }

  let body: { to?: string; businessId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.to || typeof body.to !== "string") {
    return NextResponse.json(
      { error: "Missing 'to' field (E.164 number, e.g. 923001234567)" },
      { status: 400 },
    );
  }

  // Strip any non-digit characters (spaces, dashes, plus sign, etc.)
  const to = body.to.replace(/\D/g, "");

  const sent = await provider.sendText({
    businessId: body.businessId ?? "",
    to,
    text: "AI Business Manager test message. Your WhatsApp Cloud API credentials are working!",
  });

  // If businessId is provided, persist the mapping so status webhooks
  // can resolve business ownership and be stored in whatsapp_message_status.
  let mappingInserted = false;
  if (sent.ok && sent.data.providerMessageId && body.businessId) {
    const admin = await getSupabaseAdminClient();
    if (admin) {
      const { error: mapError } = await admin
        .from("whatsapp_message_id_map")
        .insert({
          business_id: body.businessId,
          provider_message_id: sent.data.providerMessageId,
          recipient_phone: to,
        });
      mappingInserted = !mapError;
      if (mapError) {
        console.error(
          "[WhatsApp Test-Send] Failed to insert message_id_map:",
          mapError.message,
        );
      }
    }
  }

  return NextResponse.json({
    ok: sent.ok,
    reason: sent.ok ? undefined : sent.reason,
    providerMessageId: sent.ok ? sent.data.providerMessageId : null,
    mappingInserted,
  });
}
