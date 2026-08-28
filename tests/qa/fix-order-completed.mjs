/**
 * docs/fix.txt — live verification of the create_business_order "completed at
 * creation" branch fix (20260828120000_fix_create_order_completed_branch.sql).
 *
 * Runs the EXACT failing phrasing against the live server 3 separate times
 * (3 fresh conversations) and, for each attempt, reports raw evidence:
 *   - the full SSE byte stream from /api/ai/chat
 *   - the resulting order (number, status, items: product name + quantity)
 *   - stock before/after for the product
 *
 * Prerequisite fixtures are created if missing: customer "Ayaz" and an active
 * product "Sheesha Silk" (stock 200) — resolving the exact phrase.
 *
 * Usage:
 *   node --env-file=.env.local tests/qa/fix-order-completed.mjs [BASE_URL]
 *
 * Credentials: QA_EMAIL / QA_PASSWORD env vars (dinsby... account).
 */
import process from "node:process";

const BASE_URL = process.argv[2] || "http://localhost:3000";
const MESSAGE = "ayaz ka order 50 sheesha silk order complete krdo";
const ATTEMPTS = 3;

const EMAIL = process.env.QA_EMAIL;
const PASSWORD = process.env.QA_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("QA_EMAIL and QA_PASSWORD are required.");
  process.exit(2);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase public env vars (.env.local).");
  process.exit(2);
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const cookieName = `sb-${projectRef}-auth-token`;

function base64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

async function signIn() {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Sign-in failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

function restHeaders(token) {
  return { apikey: supabaseKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function postChat(cookieValue, body) {
  return fetch(`${BASE_URL}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `${cookieName}=${cookieValue}` },
    body: JSON.stringify(body),
  });
}

async function readSse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") continue;
        try {
          events.push(JSON.parse(payload));
        } catch {
          events.push({ type: "unparsed", raw: payload });
        }
      }
    }
  }
  return events;
}

async function ensureFixtures(H, businessId) {
  const cust = await fetch(
    `${supabaseUrl}/rest/v1/customers?business_id=eq.${businessId}&name=eq.Ayaz&select=id,name`,
    { headers: H },
  ).then((r) => r.json());
  let customer = cust[0];
  if (!customer) {
    await fetch(`${supabaseUrl}/rest/v1/customers`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ business_id: businessId, name: "Ayaz" }),
    });
    const again = await fetch(
      `${supabaseUrl}/rest/v1/customers?business_id=eq.${businessId}&name=eq.Ayaz&select=id,name`,
      { headers: H },
    ).then((r) => r.json());
    customer = again[0];
  }

  const prods = await fetch(
    `${supabaseUrl}/rest/v1/products?business_id=eq.${businessId}&name=eq.Sheesha%20Silk&select=id,name,stock_quantity,is_active,price`,
    { headers: H },
  ).then((r) => r.json());
  let product = prods[0];
  if (!product) {
    await fetch(`${supabaseUrl}/rest/v1/products`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        business_id: businessId,
        name: "Sheesha Silk",
        category: "fabric",
        price: 100,
        stock_quantity: 200,
        low_stock_threshold: 5,
        is_active: true,
      }),
    });
    const again = await fetch(
      `${supabaseUrl}/rest/v1/products?business_id=eq.${businessId}&name=eq.Sheesha%20Silk&select=id,name,stock_quantity,is_active,price`,
      { headers: H },
    ).then((r) => r.json());
    product = again[0];
  }
  return { customer, product };
}

async function readProductStock(H, productId) {
  const rows = await fetch(
    `${supabaseUrl}/rest/v1/products?id=eq.${productId}&select=id,stock_quantity`,
    { headers: H },
  ).then((r) => r.json());
  return rows[0]?.stock_quantity;
}

async function findNewOrders(H, businessId, customerId, since) {
  const rows = await fetch(
    `${supabaseUrl}/rest/v1/orders?business_id=eq.${businessId}&customer_id=eq.${customerId}&created_at=gte.${since.toISOString()}&select=id,order_number,status,subtotal,discount,total,created_at,order_items(*)&order=created_at.asc`,
    { headers: H },
  ).then((r) => r.json());
  return Array.isArray(rows) ? rows : [];
}

const session = await signIn();
console.log(`[fix-order-completed] signed in user=${session.user.id}`);
const H = restHeaders(session.access_token);

const business = (await fetch(
  `${supabaseUrl}/rest/v1/businesses?owner_id=eq.${session.user.id}&select=id,name`,
  { headers: H },
).then((r) => r.json()))[0];
console.log(`[fix-order-completed] business=${business.id} name=${business.name}`);

const { customer, product } = await ensureFixtures(H, business.id);
console.log(`[fixture] customer=${JSON.stringify(customer)}`);
console.log(`[fixture] product=${JSON.stringify(product)}`);
if (!customer || !product) {
  console.error("Could not create/verify fixtures.");
  process.exit(2);
}

const sessionJson = JSON.stringify({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  token_type: session.token_type ?? "bearer",
  expires_in: session.expires_in ?? 3600,
  expires_at: session.expires_at,
  user: session.user,
});
const cookieValue = `base64-${base64url(sessionJson)}`;

let failures = 0;
console.log("========================================================================");

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  const t0 = new Date();
  const stockBefore = await readProductStock(H, product.id);
  console.log(`\n################ ATTEMPT ${attempt}/${ATTEMPTS} ################`);
  console.log(`message: ${JSON.stringify(MESSAGE)}  (language: ur, fresh conversation)`);
  console.log(`stock before: ${stockBefore}`);

  const res = await postChat(cookieValue, { message: MESSAGE, language: "ur", history: [] });
  console.log(`POST ${BASE_URL}/api/ai/chat -> HTTP ${res.status}`);
  if (!res.ok) {
    console.error(await res.text());
    process.exit(1);
  }
  const events = await readSse(res);

  console.log("\n--- raw SSE events ---");
  for (const e of events) {
    if (e.type === "action") {
      console.log(`${e.type} code=${e.action?.code} phase=${e.action?.phase} params=${JSON.stringify(e.action?.params ?? {})}`);
    } else if (e.type === "status") {
      console.log(`${e.type} phase=${e.phase}`);
    } else if (e.type === "error") {
      console.log(`${e.type} code=${e.code}`);
    } else if (e.type === "done") {
      console.log(`${e.type} text=${JSON.stringify(e.text)}`);
      console.log(`${e.type} conversationId=${e.conversationId}`);
      console.log(`${e.type} actions=${JSON.stringify(e.actions)}`);
    } else {
      console.log(`${e.type} ${JSON.stringify(e).slice(0, 400)}`);
    }
  }

  const stockAfter = await readProductStock(H, product.id);
  console.log(`\nstock after: ${stockAfter}`);

  const orders = await findNewOrders(H, business.id, customer.id, t0);
  console.log(`orders created in this attempt window: ${orders.length}`);
  for (const o of orders) {
    console.log(
      `  order ${o.order_number} status=${o.status} subtotal=${o.subtotal} discount=${o.discount} total=${o.total} created_at=${o.created_at}`,
    );
    for (const item of o.order_items ?? []) {
      console.log(`    item: product=${JSON.stringify(item.product_name)} quantity=${item.quantity} unit_price=${item.unit_price} line_total=${item.line_total}`);
    }
  }

  const createdOk = orders.length >= 1;
  const statusOk = createdOk && orders.every((o) => o.status === "completed");
  const itemOk =
    createdOk &&
    orders.every((o) =>
      (o.order_items ?? []).some(
        (it) => it.quantity === 50 && String(it.product_name).toLowerCase().includes("sheesha"),
      ),
    );
  const stockDeducted = (Array.isArray(stockBefore) ? 0 : stockBefore) - (Array.isArray(stockAfter) ? 0 : stockAfter);
  const stockOk = createdOk && stockDeducted === 50 * orders.length;
  const anyErrorEvent = events.some((e) => e.type === "error");

  console.log("\n--- attempt verdict ---");
  console.log(
    `order created: ${createdOk ? "YES" : "NO"}`,
    `| status completed: ${statusOk ? "YES" : "NO"}`,
    `| qty=50 & product recorded: ${itemOk ? "YES" : "NO"}`,
    `| stock deducted (${stockBefore} -> ${stockAfter}, -${stockDeducted} == 50): ${stockOk ? "YES" : "NO"}`,
    `| SSE error event: ${anyErrorEvent ? "YES (" + (events.find((e) => e.type === "error")?.code ?? "?") + ")" : "NO"}`,
  );
  if (!createdOk || !statusOk || !itemOk || !stockOk || anyErrorEvent) failures += 1;
}

console.log("\n========================================================================");
console.log(`RESULT: ${3 - failures}/3 attempts fully correct`);
if (failures > 0) process.exit(1);