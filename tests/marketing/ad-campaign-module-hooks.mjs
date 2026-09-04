import { pathToFileURL } from "node:url";

const rootHref = pathToFileURL(process.cwd() + "/").href;

/**
 * Resolve hook for the ad-campaign tool offline test. Redirects the two
 * service modules the tool depends on (marketing/service and products/service)
 * to deterministic stub files so the tool's decision logic can be driven by
 * the test without any Supabase, secrets or business data. Everything else
 * resolves normally (the "@/" alias + server-only / next-headers stubs).
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      url: new URL("./ad-campaign-stubs/server-only.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  if (specifier === "next/headers" || specifier === "next/headers.js") {
    return {
      url: new URL("./ad-campaign-stubs/next-headers.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  if (specifier === "@/lib/marketing/service") {
    return {
      url: new URL("./ad-campaign-stubs/marketing-service.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  if (specifier === "@/lib/products/service") {
    return {
      url: new URL("./ad-campaign-stubs/products-service.mjs", import.meta.url).href,
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
