import { pathToFileURL } from "node:url";

const rootHref = pathToFileURL(process.cwd() + "/").href;

/**
 * Resolve hook for the product-service suite. Redirects ONLY the two modules
 * that would need a real network/session — the server Supabase client and the
 * business service — to deterministic stubs. Everything else (the product
 * service, its validators, the attribute/unit modules) resolves to the REAL
 * application code, so these checks prove the shipped behaviour rather than a
 * re-implementation.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: new URL("../ai/stubs/server-only.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier === "next/headers" || specifier === "next/headers.js") {
    return { url: new URL("../ai/stubs/next-headers.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier === "@/lib/supabase/server") {
    return { url: new URL("./session-stub.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier === "@/lib/business/service") {
    return { url: new URL("./session-stub.mjs", import.meta.url).href, shortCircuit: true };
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
