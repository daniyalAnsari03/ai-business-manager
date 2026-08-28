import "server-only";

import type { PendingDisambiguation } from "@/lib/ai/chat-service";
import { resolveSelectionToId } from "@/lib/ai/disambiguation-resolver";

/**
 * Decides whether the user's current reply actually refers to the
 * disambiguation state carried over from the previous turn.
 *
 * docs/fix.txt priority bug: a previously-resolved id (or a leftover candidate
 * list) could bleed across turns and silently steer the agent toward one record
 * without re-surfacing that multiple matches exist. Example: an earlier turn
 * resolved "test dup" to the Clothing product; a later turn that asks about a
 * (possibly re-ambiguous) product would then inherit a hidden "target = clothing"
 * instruction and answer about Clothing only, never mentioning that Fashion also
 * matched. That is a stale cross-request disambiguation state.
 *
 * This guard is deliberately CONSERVATIVE: it only treats the pending state as
 * active (and worth folding into the turn) when the user's new message is
 * clearly a continuation of that pending thread — a positional/attribute
 * selection among listed candidates, or a confirmation of an already-resolved
 * record. Anything else (a fresh, substantive request) is treated as STALE and
 * must be dropped so the model does a real, unambiguous search again.
 */

const CONFIM_RE_ =
  /(^|\s)(han|haan|hmm|ha|yes|yeah|yep|ok|okay|theek|theek hai|confirm|sahi|sure|ji|ja|bilkul|ho gaya|kar do|kar de)\b/;

export function isConfirmationReply(message: string): boolean {
  return CONFIM_RE_.test(message.trim().toLowerCase());
}

/**
 * True when the user's message plausibly resolves the pending disambiguation
 * (a short pick among candidates, or a confirmation of a resolved record).
 * False when the user has moved on to a new, unrelated request.
 */
export function isPendingRelevant(
  userMessage: string,
  pending: PendingDisambiguation,
): boolean {
  const hasCandidates = pending.candidates.length > 0;
  const hasResolvedId = Boolean(pending.resolvedId);

  // Nothing pending -> nothing to be relevant to.
  if (!hasCandidates && !hasResolvedId) return false;

  // The user is picking among the candidates listed last turn: a positional or
  // attribute selection. If the message is NOT such a selection, the candidates
  // are stale and must not be forced onto this turn.
  if (hasCandidates) {
    return resolveSelectionToId(userMessage, pending) !== null;
  }

  // A specific record was already resolved and we are awaiting confirmation.
  if (hasResolvedId) {
    return isConfirmationReply(userMessage);
  }

  return false;
}
