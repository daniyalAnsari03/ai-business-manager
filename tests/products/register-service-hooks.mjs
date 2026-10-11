import { register } from "node:module";

// Dedicated register entry for the product-service suite: the session/business
// modules are replaced with in-memory stubs so the REAL lib/products/service.ts
// runs offline with no Supabase, secrets or business data.
register(new URL("./service-module-hooks.mjs", import.meta.url));
