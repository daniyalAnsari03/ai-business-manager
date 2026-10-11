import { pathToFileURL } from "node:url";

const rootHref = pathToFileURL(process.cwd() + "/").href;

/**
 * Resolve hook for the audit_log tool test. Redirects the business services the
 * five audited tools call, and the service-role Supabase client the audit
 * writer uses, to deterministic stubs (same approach as the ad-campaign tool
 * test). Everything else resolves normally via the "@/" alias.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: new URL("./stubs/server-only.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier === "next/headers" || specifier === "next/headers.js") {
    return { url: new URL("./stubs/next-headers.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier === "@/lib/supabase/server") {
    return {
      url: new URL("./audit-stubs/supabase-server.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  if (specifier === "@/lib/products/service") {
    return {
      url: new URL("./audit-stubs/products-service.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  if (specifier === "@/lib/orders/service") {
    return {
      url: new URL("./audit-stubs/orders-service.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  if (specifier === "@/lib/customers/service") {
    return {
      url: new URL("./audit-stubs/customers-service.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  if (specifier === "@/lib/expenses/service") {
    return {
      url: new URL("./audit-stubs/expenses-service.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  if (specifier === "@/lib/business/service") {
    return {
      url: new URL("./audit-stubs/business-service.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  if (specifier === "@/lib/marketing/social-posts") {
    return {
      url: new URL("./audit-stubs/marketing-social-posts.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  if (specifier.startsWith("@/")) {
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
