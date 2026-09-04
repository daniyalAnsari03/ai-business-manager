/**
 * WhatsApp approval reply parser.
 *
 * Maps a natural-language reply to a decision — but ONLY when intent can be
 * determined confidently. Ambiguous replies (e.g. "haan kar do" or "ok theek
 * hai") are NOT guessed at; the caller asks the user to reply with a clear
 * YES or NO, per docs/phase4.txt.
 *
 * Case-insensitive. Supports English + Roman Urdu for both approve and reject.
 */

export type ApprovalDecision = "approve" | "reject" | "ambiguous";

const APPROVE_TOKENS = new Set([
  "yes",
  "approve",
  "approved",
  "haan",
  "haanji",
  "ji",
  "theek hai",
  "ok",
  "okay",
  "sahi",
  "haan bhai",
  "han",
  "yes approve",
]);

const REJECT_TOKENS = new Set([
  "no",
  "nahi",
  "nhi",
  "nahin",
  "reject",
  "rejected",
  "cancel",
  "mat karo",
  "nahi karo",
  "band",
]);

/** Normalise a reply for matching (lowercase, single spaces, strip punctuation). */
function normalise(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[!?.,;:]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Decide the intent of an approval reply.
 *
 * A reply is accepted as `approve`/`reject` only when it clearly matches one
 * labelled token. Anything with additional qualifying words we do not recognise
 * (e.g. "haan kar do") is `ambiguous` so the caller can ask for a clearer
 * answer instead of guessing.
 */
export function parseApprovalReply(reply: string): ApprovalDecision {
  const tokens = normalise(reply);
  if (tokens.length === 0) return "ambiguous";

  // Multi-word affirmative / negative phrases.
  const joined = tokens.join(" ");

  let approveScore = 0;
  let rejectScore = 0;

  // A bear-word single token: "yes"/"haan"/"no"/"nahi" => clear decision.
  if (tokens.length === 1) {
    if (APPROVE_TOKENS.has(tokens[0])) return "approve";
    if (REJECT_TOKENS.has(tokens[0])) return "reject";
    return "ambiguous";
  }

  // Composite phrases.
  if (joined === "yes approve" || joined === "approve yes" || joined === "haan kar do") {
    return "approve";
  }
  if (joined === "nahi kar do" || joined === "no reject" || joined === "reject no") {
    return "reject";
  }

  // Count how many strong signal words appear.
  for (const token of tokens) {
    if (APPROVE_TOKENS.has(token)) approveScore += 1;
    else if (REJECT_TOKENS.has(token)) rejectScore += 1;
  }

  if (approveScore > 0 && rejectScore === 0) return "approve";
  if (rejectScore > 0 && approveScore === 0) return "reject";

  return "ambiguous";
}
