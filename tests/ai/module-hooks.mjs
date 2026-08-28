import { pathToFileURL } from "node:url";

const rootHref = pathToFileURL(process.cwd() + "/").href;

/**
 * Resolves the project's "@/" TypeScript path alias for plain-Node test runs
 * so the real server modules can be exercised without a bundler.
 */
export async function resolve(specifier, context, nextResolve) {
  // Next.js provides `server-only`; plain-Node test runs use a no-op stub
  // (the react-server condition makes the real package a no-op as well).
  if (specifier === "server-only") {
    return { url: new URL("./stubs/server-only.mjs", import.meta.url).href, shortCircuit: true };
  }
  // Request-scoped Next.js APIs must never be invoked outside a request.
  // The stub only needs to exist so server modules can be imported; any real
  // call is a test bug and should fail loudly.
  if (specifier === "next/headers" || specifier === "next/headers.js") {
    return { url: new URL("./stubs/next-headers.mjs", import.meta.url).href, shortCircuit: true };
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
