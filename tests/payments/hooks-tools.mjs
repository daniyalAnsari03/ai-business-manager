import { pathToFileURL } from "node:url";

const rootHref = pathToFileURL(process.cwd() + "/").href;

/**
 * Import hook for the AI-tool tests. Resolves the "@/" alias and swaps the
 * Supabase session plumbing, the business service, approval outbound channels
 * and the customers/orders/suppliers/supplier-bills/payments READ services
 * for in-memory stand-ins (tests/payments/stubs/*). The approval service,
 * its executors, the service-role wrapper, the audit writer and the AI tools
 * themselves stay REAL.
 */
const redirects = {
  "@/lib/supabase/server": "fake-supabase.mjs",
  "@/lib/business/service": "business-service.mjs",
  "@/lib/marketing/automation": "automation.mjs",
  "@/lib/marketing/whatsapp/approval-notify": "approval-notify.mjs",
  "@/lib/marketing/publish": "publish.mjs",
  "@/lib/customers/service": "read-services.mjs",
  "@/lib/orders/service": "read-services.mjs",
  "@/lib/suppliers/service": "read-services.mjs",
  "@/lib/supplier-bills/service": "read-services.mjs",
  "@/lib/payments/service": "read-services.mjs",
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