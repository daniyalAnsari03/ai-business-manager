import "server-only";

import type { Language } from "@/lib/business/types";

/**
 * WhatsApp approval message formatting (English / Roman Urdu).
 *
 * The message includes a short, secure, human-visible reference id
 * (`external_reference` on approval_actions) so the webhook maps a reply to
 * EXACTLY one action — never "the latest pending one". The reference is not a
 * secret here; it is scoped per business and is just enough to route a reply.
 */

export interface ApprovalMessageContext {
  summary: string;
  platform?: string | null;
  productName?: string | null;
  scheduledAt?: string | null;
  language: Language;
}

/** Generates the short human-visible reference used as external_reference. */
export function generateApprovalReference(): string {
  // 6 secure random hex chars. Collisions are practically impossible and are
  // further guarded by the unique (business_id, external_reference) intent.
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Formats a time for display in the WhatsApp message. */
function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Builds the localized WhatsApp approval request body. */
export function buildApprovalMessage(
  context: ApprovalMessageContext,
  reference: string,
): string {
  if (context.language === "ur") {
    const lines = [
      "AI Business Manager",
      "",
      "Approve karna hai",
      "",
      `Action: ${context.summary}`,
    ];
    if (context.platform) lines.push(`Platform: ${context.platform}`);
    if (context.productName) lines.push(`Product: ${context.productName}`);
    const time = formatTime(context.scheduledAt);
    if (time) lines.push(`Time: ${time}`);
    lines.push(
      "",
      `Reference: ${reference}`,
      "",
      "Reply karein:",
      "YES → approve karna hai",
      "NO → reject karna hai",
    );
    return lines.join("\n");
  }

  const lines = [
    "AI Business Manager",
    "",
    "Approval required",
    "",
    `Action: ${context.summary}`,
  ];
  if (context.platform) lines.push(`Platform: ${context.platform}`);
  if (context.productName) lines.push(`Product: ${context.productName}`);
  const time = formatTime(context.scheduledAt);
  if (time) lines.push(`Time: ${time}`);
  lines.push(
    "",
    `Reference: ${reference}`,
    "",
    "Reply:",
    "YES to approve",
    "NO to reject",
  );
  return lines.join("\n");
}
