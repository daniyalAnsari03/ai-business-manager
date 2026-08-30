import fs from "node:fs";
import path from "node:path";

const envRaw = fs.readFileSync(path.resolve(".env.local"), "utf8");
const gv = (k, prefix = k + "=") => {
  const l = envRaw.split(/\r?\n/).find((x) => x.startsWith(prefix));
  return l ? l.slice(prefix.length).trim() : "";
};
const SUPABASE_URL = gv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY = gv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const EMAIL = gv("email:", "email: ");
const PASSWORD = gv("password:", "password: ");

const s = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).then((r) => r.json());
const h = { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.access_token}` };

const biz = (
  await fetch(
    `${SUPABASE_URL}/rest/v1/businesses?owner_id=eq.${s.user.id}&select=id`,
    { headers: h },
  ).then((r) => r.json())
)[0];
const BIZ = biz.id;

const del = (table, filter) =>
  fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: { ...h, Prefer: "return=minimal" },
  }).then((r) => r.status);

const prods = await fetch(
  `${SUPABASE_URL}/rest/v1/products?business_id=eq.${BIZ}&select=id,name`,
  { headers: h },
).then(async (r) => {
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error("products query error: " + JSON.stringify(j));
  return j.filter((p) => /Phase2 Test Kurta|Phase2 Kurta/i.test(p.name || ""));
});

let cleaned = 0;
for (const p of prods) {
  await del("social_posts", `product_id=eq.${p.id}`);
  const st = await del("products", `id=eq.${p.id}`);
  console.log(`deleted product ${p.id} (${p.name}) status=${st}`);
  cleaned++;
}
const disp = await del("social_posts", "product_id=eq.d38ac2e0-f447-4f8a-b2fa-aad4e504ab8c");
await del("products", "id=eq.d38ac2e0-f447-4f8a-b2fa-aad4e504ab8c");
console.log(`disposable(product d38ac2e0) posts status=${disp}`);
console.log(`cleaned ${cleaned} test products (+ their social_posts)`);
