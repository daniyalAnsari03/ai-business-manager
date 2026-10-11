import { pathToFileURL } from "node:url";

const rootHref = pathToFileURL(process.cwd() + "/").href;

/**
 * Import hook for the payments/suppliers SERVICE tests. Resolves the "@/"
 * alias like tests/ai/module-hooks.mjs but additionally swaps the real
 * Supabase session plumbing and the business service for deterministic
 * in-memory stand-ins (tests/payments/stubs/*). The service modules under
 * test (payments, suppliers, supplier-bills, service-role) stay REAL and run
 * against the fake database.
 */
const redirects = {
  "@/lib/supabase/server": "fake-supabase.mjs",
  "@/lib/business/service": "business-service.mjs",
};

function stubUrl(specifier) {
  const stubFile = redirects[specifier];
  if (!stubFile) return null;
  return new URL(`./stubs/${stubFile}`, import.meta.url).href;
}

export async function resolve(specifier, context, nextResolve) {
  // Next.js provides `server-only`; plain-Node test runs use a no-op stub
  // (the react-server condition makes the real package a no-op as well).
  if (specifier === "server-only") {
    return { url: new URL("./stubs/server-only.mjs", import.meta.url).href, shortCircuit: true };
  }
  // Request-scoped Next.js APIs must never be invoked outside a request.
  if (specifier === "next/headers" || specifier === "next/headers.js") {
    return { url: new URL("./stubs/next-headers.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const swapped = stubUrl(specifier);
    if (swapped) return { url: swapped, shortCircuit: true };
    const rel = specifier.slice(2);
    for (const candidate of [`${rel}.ts`, `${rel}.tsx`, `${rel}/index.ts`, rel]) {
      try {
        return await nextResolve(rootHref + candidate, context);
      } catch {
        // Try the next candidate.
      }
    }
  }
  return nextResolve(specifier, context);
}