/**
 * Focused repro: identify the /dashboard/settings hydration mismatch and
 * whether it blocks the marketing budget-cap save.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.argv[2] || "http://localhost:3001";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const envRaw = fs.readFileSync(path.resolve(".env.local"), "utf8");
const gv = (k, p = k + "=") => {
  const l = envRaw.split(/\r?\n/).find((x) => x.startsWith(p));
  return l ? l.slice(p.length).trim() : "";
};
const EMAIL = gv("email:", "email: ");
const PASSWORD = gv("password:", "password: ");

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const mismatches = [];
const others = [];
page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const text = msg.args().map((a) => String(a.jsonValue() ?? "")).join(" ").slice(0, 5000);
  if (/hydrated but some attributes/u.test(text)) mismatches.push({ url: page.url(), text });
  else others.push({ url: page.url(), text: text.slice(0, 300) });
});

await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120000 });
await page.locator("#login-email").fill(EMAIL);
await page.locator("#login-password").fill(PASSWORD);
await page.locator("form button[type=submit]").first().click();
await page.waitForURL(/\/dashboard/, { timeout: 60000 });

// seed a deterministic localStorage baseline
await page.evaluate(() => localStorage.setItem("abm-lang", "ur"));
await page.goto(`${BASE}/dashboard/marketing`, { waitUntil: "load", timeout: 90000 });
await page.waitForSelector('h1:has-text("Marketing")');
console.log("[1] marketing page OK (ur baseline from localStorage)");
await page.goto(`${BASE}/dashboard/settings`, { waitUntil: "load", timeout: 90000 });
await page.waitForSelector("#marketing-monthly-budget-cap", { timeout: 30000 });
console.log("[2] settings page loaded");

const budgetForm = page.locator("form", { has: page.locator("#marketing-monthly-budget-cap") });
const saveBtn = budgetForm.locator('button[type="submit"]');
const input = page.locator("#marketing-monthly-budget-cap");

// attempt 1 on fresh page
await input.fill("1111");
await saveBtn.click();
await page.waitForTimeout(3500);
const v1 = await input.inputValue();
console.log("[3] first save attempt → input:", JSON.stringify(v1), "(1111 expected if the click worked)");

// reload + attempt 2
await page.reload({ waitUntil: "load", timeout: 60000 });
await page.waitForSelector("#marketing-monthly-budget-cap");
await input.fill("2222");
await saveBtn.click();
await page.waitForTimeout(3500);
const v2 = await input.inputValue();
console.log("[4] second save attempt (after reload) → input:", JSON.stringify(v2));

console.log(`\nhydration mismatches captured: ${mismatches.length}`);
mismatches.forEach((m, i) => {
  console.log(`\n--- mismatch #${i + 1} @${m.url} ---`);
  console.log(m.text);
});
console.log(`\nother console errors: ${others.length}`);
others.forEach((o) => console.log(`  @${o.url} ${o.text}`));

await browser.close();