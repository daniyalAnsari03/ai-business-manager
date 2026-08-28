import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tracker = JSON.parse(
  readFileSync(path.join(__dirname, "created-records.json"), "utf8"),
);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.QA_EMAIL;
const password = process.env.QA_PASSWORD;

const created = tracker.created;

function ids(list) {
  return list.map((id) => `"${id}"`).join(",");
}

async function del(table, idList) {
  if (!idList.length) {
    console.log(`skip ${table} (0)`);
    return;
  }
  const res = await fetch(`${url}/rest/v1/${table}?id=in.(${ids(idList)})`, {
    method: "DELETE",
    headers: {
      apikey: key,
      Authorization: `Bearer ${process.env.ABM_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  console.log(`${table} deleted ids=${idList.length} status=${res.status}`);
}

async function main() {
  const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const session = await authRes.json();
  process.env.ABM_TOKEN = session.access_token;
  if (!process.env.ABM_TOKEN) {
    console.error("AUTH FAILED", JSON.stringify(session));
    process.exit(1);
  }
  console.log("signed in", session.user?.id);

  // Capture image paths BEFORE the product rows are removed.
  const imagePaths = [];
  const selRes = await fetch(
    `${url}/rest/v1/products?select=id,image_url&id=in.(${ids(created.products)})`,
    { headers: { apikey: key, Authorization: `Bearer ${process.env.ABM_TOKEN}` } },
  );
  if (selRes.ok) {
    const rows = await selRes.json();
    for (const r of rows) {
      if (r.image_url && r.image_url.includes("/storage/v1/object/public/")) {
        const pathPart = r.image_url.split("/storage/v1/object/public/")[1];
        imagePaths.push(pathPart);
      }
    }
  }
  console.log("images to delete:", JSON.stringify(imagePaths));

  await del("orders", created.orders);
  await del("products", created.products);
  await del("customers", created.customers);
  await del("expenses", created.expenses);
  await del("ai_conversations", created.ai_conversations);

  for (const p of imagePaths) {
    const res = await fetch(
      `${url}/storage/v1/object/${p}`,
      {
        method: "DELETE",
        headers: {
          apikey: key,
          Authorization: `Bearer ${process.env.ABM_TOKEN}`,
        },
      },
    );
    console.log(`storage delete ${p} status=${res.status}`);
  }
}

main();
