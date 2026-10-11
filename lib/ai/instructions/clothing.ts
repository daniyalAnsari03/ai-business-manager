/**
 * Clothing / fashion section of the AI Business Manager instructions
 * (docs/p3.txt — File 3 / Phase 2 / Prompt 3).
 *
 * Pure TypeScript with no server-only import, so the text can be unit tested
 * offline (tests/ai/agent-instructions.mjs) and reused anywhere later.
 *
 * WHY THIS EXISTS AS A SEPARATE MODULE
 * The business types that speak clothing are decided by the BUSINESS TYPE
 * capability `fabric_attributes` (lib/business/type-config.ts), not by the
 * language. agent.ts appends this section only for a business that has that
 * capability, so every other business type keeps byte-for-byte the same
 * instructions it has today — including a clothing business whose type is not
 * yet known or not valid (it resolves to "other" and gets no clothing text).
 *
 * WHY THE OPTION LISTS ARE IMPORTED, NEVER RE-TYPED
 * The predefined attribute options and unit labels are the product's source of
 * truth (lib/business/product-attributes.ts, lib/business/product-units.ts).
 * They are rendered straight from those arrays here, so the prompt text can
 * never drift away from what the validators actually accept: a store may edit
 * either list and the instructions follow automatically.
 *
 * The lists are SUGGESTIONS, never a whitelist — which is why every line is
 * followed by the "custom values are allowed" rule. The offline test asserts
 * each rendered list is exactly the current array, in order.
 */

import {
  CLOTHING_ATTRIBUTE_KEYS,
  CLOTHING_ATTRIBUTE_OPTIONS,
} from "@/lib/business/product-attributes";
import { UNIT_OPTIONS } from "@/lib/business/product-units";
import type { Language } from "@/lib/business/types";

/**
 * One "- <key> options: a, b, c" line per attribute, plus the unit labels.
 * Built from the code so the text is always the current vocabulary.
 */
function optionLines(): string[] {
  const lines = CLOTHING_ATTRIBUTE_KEYS.map(
    (key) => `- ${key} options: ${CLOTHING_ATTRIBUTE_OPTIONS[key].join(", ")}`,
  );
  lines.push(`- unit options: ${UNIT_OPTIONS.join(", ")}`);
  return lines;
}

/** Maximum lines the section may use, per language (offline test enforces it). */
export const CLOTHING_SECTION_LINE_BUDGET = 25;

/**
 * The clothing section for one language.
 *
 * Deliberately short: it is appended to an already long prompt, so every line
 * has to earn its place. The rules are the ones a shop owner can actually feel
 * — do not invent a fabric, do not turn 2.5 meter into 3, do not pass a cost
 * price off as the selling price.
 *
 * Mirrors buildLanguageRule in agent.ts: "ur" is Roman Urdu, anything else is
 * English.
 */
export function buildClothingProductInstructions(language: Language): string {
  if (language === "ur") {
    return [
      "CLOTHING PRODUCTS (yeh business kapda bechta hai):",
      "- Ek clothing product mein yeh ho sakta hai: product type, fabric, color, design, size, unit aur cost price.",
      ...optionLines(),
      "- Har ek mein apna custom value bhi chal sakta hai (jaise fabric \"Chikankari\" ya unit \"Bundle\"). Yeh lists madad ke liye hain, limit nahi.",
      "- Inhein in tool parameters mein bhejein: product_type, fabric, color, design, size, unit, cost_price. Koi attribute hatana ho to uska naam clear_attributes mein bhejein.",
      "- SIRF wohi save karein jo user ne khud bataya. Fabric, design, size, color, unit, cost price ya stock ki koi guess kabhi na karein. Jo user ne nahi bataya, wo parameter chhor dein.",
      "- Lambi sawaal list mat banayein: naye product ke liye naam aur selling price kaafi hain. Sirf wohi poochein jo sach mein missing hai (jaise category), aur ek chhota sawaal ek waqt mein.",
      "- User ka lafz list ke option se tabhi jodein jab uska matlab bilkul saaf ho. Warna ek baar pooch lein, ya user ka apna lafz custom value ki soorat mein save kar dein. Matlab khud se badal dein.",
      "- cost_price wo private price hai jo business ne ek unit lene par diya. Ye selling price NAHI hai, aur ise kabhi selling price ki tarah na batayein.",
      "- Sale/revenue phir bhi revenue hai, profit nahi. Profit ka koi waada mat karein.",
      "- Quantity hamesha unit ke saath batayein (jaise \"50 Meter\" ya \"12 Piece\").",
      "- Stock sirf poore numbers ka hota hai. Agar user \"2.5 meter\" jaisi adhoori quantity maange, to seedha bata dein ke adhoori quantity abhi support nahi hai — ghis ke number mat kar dein.",
      "- Product banane ya update karne ke baad, keh dein ke tool ne exactly kaun se attributes save kiye. Jo save nahi hua, wo bhi bata dein.",
    ].join("\n");
  }

  return [
    "CLOTHING PRODUCTS (this business sells clothing):",
    "- A clothing product can carry: product type, fabric, color, design, size, unit and cost price.",
    ...optionLines(),
    "- Custom values are always allowed on every one of them (e.g. fabric \"Chikankari\" or unit \"Bundle\"). These lists are a help, not a limit.",
    "- Pass them as these tool parameters: product_type, fabric, color, design, size, unit, cost_price. To remove an attribute from a product, pass its name in clear_attributes.",
    "- ONLY save what the user actually said. Never guess fabric, design, size, color, unit, cost price or whether something is in stock. If the user did not say it, leave that parameter out.",
    "- Do not run a long questionnaire: for a new product the name and the selling price are enough. Ask only for what is genuinely missing (e.g. the category), one short question at a time.",
    "- Map the user's word to a listed option only when the meaning is unambiguous. Otherwise ask once, or store the user's own word as a custom value. Never quietly give it a different meaning.",
    "- cost_price is the private price the business PAID for one unit. It is NOT the selling price and must never be presented as it.",
    "- Sales/revenue is still revenue, not profit. Never promise a profit figure.",
    "- Always state quantities with the unit (e.g. \"50 Meter\" or \"12 Piece\").",
    "- Stock is whole numbers only. If the user asks for a fractional quantity (e.g. \"2.5 meter\"), say plainly that fractional quantities are not supported yet — never round it silently.",
    "- After creating or updating a product, state exactly which attributes the tool saved. If the tool did not save something, say so.",
  ].join("\n");
}