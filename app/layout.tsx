import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { displayFallback, inter } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AI Business Manager — Business management with AI that works",
    template: "%s · AI Business Manager",
  },
  description:
    "A premium business management system where an AI manager checks your real numbers, performs approved actions and verifies every result. English aur Roman Urdu dono mein.",
  keywords: [
    "AI Business Manager",
    "business management",
    "inventory",
    "sales",
    "Roman Urdu",
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Applies the persisted (or default dark) theme before first paint so there
 * is no flash of the wrong theme. Kept tiny and dependency-free.
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem("abm-theme");document.documentElement.classList.toggle("dark",t!=="light");}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark min-h-full ${inter.variable} ${displayFallback.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-emerald-500 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-emerald-950"
        >
          Skip to content
        </a>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
