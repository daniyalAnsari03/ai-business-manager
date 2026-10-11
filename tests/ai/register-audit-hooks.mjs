import { register } from "node:module";

// Dedicated register entry for the audit_log wiring test: the product, order
// and customer services plus the service-role Supabase client are replaced with
// deterministic stubs so the tools' real execute() logic can be driven offline
// with no Supabase, secrets or business data.
register(new URL("./audit-module-hooks.mjs", import.meta.url));
