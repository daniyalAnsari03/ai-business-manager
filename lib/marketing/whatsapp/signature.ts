import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

/**
 * WhatsApp Cloud API webhook signature verification (Meta).
 *
 * Meta signs every webhook POST with an `X-Hub-Signature-256` header of the
 * form `sha256=<hex mac>` computed over the raw request body using the app
 * secret. We must verify this BEFORE trusting the payload, otherwise any
 * unauthenticated caller could spoof an approval reply.
 */

/**
 * Verifies the X-Hub-Signature-256 header against the raw request body.
 * Returns true only when the signature is present, the algorithm matches and
 * the HMAC-SHA256 digests are equal (constant-time comparison).
 */
export function verifyHubSignature(
  signatureHeader: string | null,
  rawBody: string | Buffer,
  appSecret: string | undefined,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const parts = signatureHeader.split(",").map((p) => p.trim());
  const sha256Part = parts.find((p) => p.startsWith("sha256="));
  if (!sha256Part) return false;

  const provided = sha256Part.slice("sha256=".length);
  if (!/^[0-9a-fA-F]{64}$/.test(provided)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const providedBuf = Buffer.from(provided, "hex");
  const expectedBuf = Buffer.from(expected, "hex");

  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}
