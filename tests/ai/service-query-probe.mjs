/**
 * READ-ONLY live probe: verifies the AI-facing service query shapes against
 * the REAL Supabase project (schema validity, relationship embeds, filters).
 *
 * Runs UNAUTHENTICATED (publishable/anon key only): RLS returns zero rows,
 * but PostgREST answers 400 for any invalid embed/filter/column. A 200 with
 * an empty array therefore PROVES the query shape is valid without touching
 * any business data. No secrets printed; no writes performed.
 *
 * Run: node tests/ai/service-query-probe.mjs
 */

import { readFileSync } from "node:fs";

function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !(match[1] in process.env)) {
        process.env[match[1]] = match[2].trim();
      }
    }
  } catch {
    // Fall back to ambient env.
  }
}
loadEnvLocal();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase public env vars missing (.env.local).");
  process.exit(2);
}

/** Unauthenticated business id — RLS scopes every result to zero rows. */
const NIL_BUSINESS = "00000000-0000-0000-0000-000000000000";

const QUERIES = [
  {
    name: "sales.getTopSellingProducts — order_items ⨝ completed orders (days window)",
    url: `/rest/v1/order_items?select=product_name,quantity,line_total,orders!inner(status,ordered_at)&business_id=eq.${NIL_BUSINESS}&orders.status=eq.completed&orders.ordered_at=gte.${new Date(Date.now() - 30 * 86_400_000).toISOString()}&limit=5`,
  },
  {
    name: "orders.getOrdersByCustomer — orders + items embed for one customer",
    url: `/rest/v1/orders?select=*,order_items(*)&business_id=eq.${NIL_BUSINESS}&customer_id=eq.${NIL_BUSINESS}&order=ordered_at.desc&limit=10`,
  },
  {
    name: "expenses.getExpenseStats fields — title/amount/category/expense_date",
    url: `/rest/v1/expenses?select=title,amount,category,expense_date&business_id=eq.${NIL_BUSINESS}&limit=1`,
  },
  {
    name: "sales.getSalesSummary fields — total/ordered_at (completed only)",
    url: `/rest/v1/orders?select=total,ordered_at&business_id=eq.${NIL_BUSINESS}&status=eq.completed&limit=1`,
  },
];

let failed = 0;
for (const query of QUERIES) {
  const res = await fetch(`${supabaseUrl}${query.url}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  const body = await res.text();
  const rows = res.ok ? JSON.parse(body) : null;
  const pass = res.ok && Array.isArray(rows);
  if (!pass) failed += 1;
  console.log(
    `${pass ? "PASS" : "FAIL"} — ${query.name} → ${res.status}${pass ? ` (${rows.length} rows under anon RLS)` : ` body=${body.slice(0, 200)}`}`,
  );
}

console.log(failed === 0 ? "\nAll service queries valid against live database." : `\n${failed} query shape failure(s).`);
process.exitCode = failed === 0 ? 0 : 1;
