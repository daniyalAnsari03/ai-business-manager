import "server-only";

import type { PendingDisambiguation } from "@/lib/ai/chat-service";

/**
 * Deterministic, server-side resolution of a user's short selection
 * ("pehla wala", "clothing wala", "1st", "second", ...) to the EXACT id the
 * model should target.
 *
 * This is the robustness layer for docs/fix.txt: even if a model struggles to
 * echo a long database uuid out of a JSON candidate blob across turns, the
 * route can map the user's pick to the correct candidate id itself and hand it
 * to the model as an authoritative target — so an id lookup never silently
 * misses because the model truncated/guessed the uuid.
 *
 * Returns the candidate id when the pick is unambiguous, or null when it is not
 * (in which case the caller re-lists the candidates for the model).
 */
export function resolveSelectionToId(
  userMessage: string,
  pending: PendingDisambiguation,
): string | null {
  const candidates = pending.candidates;
  if (!candidates || candidates.length === 0) return null;
  const msg = userMessage.trim().toLowerCase();

  // 1) Positional pick: "pehla / first / 1 / 1st / ek", "doosra / second / 2 / 2nd".
  const pos = (() => {
    if (/(^|\s)(pehla|phela|first|1|1st|one|ek)\b/.test(msg) || /pehli/.test(msg)) {
      return 0;
    }
    if (/(^|\s)(doosra|dusra|second|2|2nd|two)\b/.test(msg)) {
      return 1;
    }
    if (/(^|\s)(teesra|tusra|third|3|3rd|three|teen)\b/.test(msg)) {
      return 2;
    }
    if (/(^|\s)(chautha|fourth|4|4th|four|char)\b/.test(msg)) {
      return 3;
    }
    return undefined;
  })();
  if (pos !== undefined && candidates.length > pos) {
    const id = candidates[pos].id;
    console.log("[disambiguation] positional pick -> candidate index", pos, "id", JSON.stringify(id));
    return id;
  }

  // 2) Attribute pick: user names a distinguishing attribute we listed, e.g.
  //    "clothing wala" / "fashion wala" -> match against each candidate's
  //    category (or name/sku/price/stock) to pick the ONE it refers to.
  const attrTokens = msg
    .replace(/wala|wali|wale/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
  if (attrTokens.length > 0) {
    const rawOf = (c: (typeof candidates)[number]) => {
      const cat = String(c.category ?? "");
      const name = String(c.name ?? "");
      const sku = String(c.sku ?? "");
      const price = c.price != null ? String(c.price) : "";
      const stock = c.stockQuantity != null ? String(c.stockQuantity) : "";
      return `${cat} ${name} ${sku} ${price} ${stock}`.toLowerCase();
    };

    // Count how many candidates each token appears in. Common tokens that
    // appear in every candidate ("qa", "dup" above) must NOT make every
    // candidate a match — only a token that uniquely identifies ONE candidate
    // should resolve deterministically. This prevents a pick of "Clothing wala
    // qa dup" from being seen as ambiguous just because "qa"/"dup" are shared.
    const tokenOccurrences = new Map<string, number>();
    for (const c of candidates) {
      const raw = rawOf(c);
      for (const tok of attrTokens) {
        if (raw.includes(tok)) {
          tokenOccurrences.set(tok, (tokenOccurrences.get(tok) ?? 0) + 1);
        }
      }
    }

    // Strong matches: candidates containing at least one token that no OTHER
    // candidate contains (a real discriminator the user mentioned).
    const strongMatches = candidates.filter((c) => {
      const raw = rawOf(c);
      return attrTokens.some(
        (tok) => raw.includes(tok) && (tokenOccurrences.get(tok) ?? 0) === 1,
      );
    });
    if (strongMatches.length === 1) {
      const id = strongMatches[0].id;
      console.log("[disambiguation] attribute pick -> candidate id", JSON.stringify(id));
      return id;
    }
    if (strongMatches.length > 1) {
      console.log(
        "[disambiguation] attribute pick ambiguous (strong matches",
        strongMatches.length,
        ") — leaving to model:",
        JSON.stringify(strongMatches.map((c) => c.id)),
      );
      return null;
    }

    // Fall back to the previous broad any-token matching only when no unique
    // discriminator exists.
    const fieldMatches = candidates.filter((c) => {
      const raw = rawOf(c);
      return attrTokens.some((tok) => raw.includes(tok));
    });
    if (fieldMatches.length === 1) {
      const id = fieldMatches[0].id;
      console.log("[disambiguation] attribute pick -> candidate id", JSON.stringify(id));
      return id;
    }
    if (fieldMatches.length > 1) {
      console.log(
        "[disambiguation] attribute pick ambiguous (matched",
        fieldMatches.length,
        ") — leaving to model:",
        JSON.stringify(fieldMatches.map((c) => c.id)),
      );
    }
  }

  console.log("[disambiguation] no deterministic selection match; msg=", JSON.stringify(msg));
  return null;
}
