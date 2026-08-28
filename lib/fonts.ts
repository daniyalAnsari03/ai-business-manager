import { Cormorant_Garamond, Inter } from "next/font/google";

/**
 * UI / body typeface (AGENTS.md §17).
 * Used for navigation, paragraphs, labels, buttons, forms, dashboard,
 * tables, notifications, the AI interface and Roman Urdu copy.
 */
export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * Display / hero fallback typeface.
 *
 * The locked brand direction specifies `Ferly` (a licensed commercial
 * serif). Per the free-first requirement we do not bundle a paid font;
 * instead "Ferly" leads the display stack (see --font-display in
 * globals.css) so licensed Ferly files can later be dropped in via
 * next/font/local without any other code change. Until then this free,
 * elegant, light editorial serif carries the same premium direction.
 */
export const displayFallback = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-display-fallback",
  display: "swap",
});
