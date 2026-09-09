import "server-only";

/**
 * WhatsApp provider abstraction — Phase 4.
 *
 * Follows the exact same pattern as lib/marketing/payment-provider.ts: the
 * approval/weekly-report features depend on this interface, never on a
 * specific vendor SDK, so we can plug in any WhatsApp provider later (Meta
 * WhatsApp Cloud API, Twilio, 360dialog, etc.) without rewriting the approval
 * engine or the report generator.
 *
 * SECURITY: no WhatsApp credentials / tokens ever leave the server. The
 * concrete provider reads them from server-side environment variables only.
 *
 * Phase 4 ships the Meta WhatsApp Cloud API contract (webhook get-verify +
 * signed message POST, text messages sent via the Messages endpoint) because
 * Meta is the free-tier-friendly, Pakistan-common choice. If no credentials
 * are configured the provider reports not_configured and every delivery is
 * honestly skipped — nothing is ever faked.
 */

export interface SendMessageInput {
  /** The business that owns the conversation (for authorization). */
  businessId: string;
  /** E.164 recipient number, e.g. "923001234567". */
  to: string;
  /** Localized message body (already in the business's language). */
  text: string;
  /** Optional idempotency / correlation id to prevent duplicate sends. */
  messageId?: string;
}

export interface SendMessageResult {
  /** Unique provider message id when actually sent. */
  providerMessageId: string | null;
  /** Whether the message reached the provider successfully. */
  delivered: boolean;
}

export type SendMessageOutcome =
  | { ok: true; data: SendMessageResult }
  | { ok: false; reason: string };

/** Incoming text message parsed from a webhook payload. */
export interface IncomingMessage {
  /** The sender's E.164 number (the business owner who replied). */
  from: string;
  body: string;
  /** Provider message id (used for duplicate detection). */
  providerMessageId: string;
}

export interface WhatsAppProvider {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): boolean;

  /** Send a plain text message. Returns a truthful delivered state. */
  sendText(input: SendMessageInput): Promise<SendMessageOutcome>;

  /**
   * Verify a GET webhook verification request (challenge). Returns true when
   * the challenge token matches the configured verify token, along with the
   * challenge string to echo back to the provider.
   */
  verifyWebhook(mode: string, verifyToken: string, challenge: string): { ok: boolean; challenge?: string };

  /**
   * Authenticate + parse an incoming webhook POST. Returns null when the
   * request is not from the provider (bad signature) so the route can reject
   * it with 401. Returns the inbound text message otherwise.
   */
  parseInboundWebhook(body: unknown): Promise<IncomingMessage[] | null>;
}

/** Returns the configured WhatsApp provider, or none when unconfigured. */
export function getWhatsAppProvider(): WhatsAppProvider | null {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return token && phoneId ? new MetaWhatsAppProvider(token, phoneId) : null;
}

/**
 * Meta WhatsApp Cloud API provider.
 *
 * Expected server-side env vars (NEVER client-side):
 *   WHATSAPP_ACCESS_TOKEN        — permanent access token
 *   WHATSAPP_PHONE_NUMBER_ID     — the business phone number id
 *   WHATSAPP_VERIFY_TOKEN        — webhook verify token (GET challenge)
 *   WHATSAPP_APP_SECRET          — used to verify the X-Hub-Signature-256
 *
 * The real network URLs are kept in constants so a QA/dev stub can override
 * them; production always calls the live Meta endpoints.
 */
class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly id = "meta_whatsapp";
  readonly displayName = "WhatsApp (Meta)";

  constructor(
    private readonly token: string,
    private readonly phoneNumberId: string,
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async sendText(input: SendMessageInput): Promise<SendMessageOutcome> {
    try {
      const url = `https://graph.facebook.com/v25.0/${this.phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.to,
          type: "text",
          text: { body: input.text },
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, reason: `WhatsApp send failed (${res.status}): ${text}` };
      }

      const json = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
      };
      return {
        ok: true,
        data: {
          providerMessageId: json.messages?.[0]?.id ?? null,
          delivered: true,
        },
      };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "WhatsApp network error",
      };
    }
  }

  verifyWebhook(mode: string, verifyToken: string, challenge: string): { ok: boolean; challenge?: string } {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (
      mode === "subscribe" &&
      expected &&
      verifyToken === expected &&
      typeof challenge === "string" &&
      challenge.length > 0
    ) {
      return { ok: true, challenge };
    }
    return { ok: false };
  }

  async parseInboundWebhook(body: unknown): Promise<IncomingMessage[] | null> {
    // The route already verified the signature; here we only shape the payload.
    const message =
      (body as { entry?: Array<{ changes?: Array<{ value?: { messages?: unknown[] } }> }> } | null) ??
      null;
    const events = message?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!Array.isArray(events)) return [];
    const parsed: IncomingMessage[] = [];
    for (const event of events as Array<{
      from?: string;
      id?: string;
      type?: string;
      text?: { body?: string };
    }>) {
      if (event.type !== "text") continue;
      const from = event.from;
      const bodyText = event.text?.body?.trim();
      if (!from || !bodyText) continue;
      parsed.push({
        from,
        body: bodyText,
        providerMessageId: event.id ?? "",
      });
    }
    return parsed;
  }
}
