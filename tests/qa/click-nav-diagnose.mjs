import { chromium } from "playwright-core";

const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3000";
const PASS = process.argv[3] || "dev";

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const failed = [];
  page.on("response", (res) => {
    if (res.status() >= 400) failed.push({ status: res.status(), url: res.url() });
  });
  const t0 = Date.now();
  await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(1500);
  const loadMs = Date.now() - t0;

  await page.locator('header a[href="/login"]').first().click();
  await page.waitForTimeout(3000);
  const state = await page.evaluate(() => ({
    url: location.href,
    hasEmail: !!document.querySelector("#login-email"),
    hasForm: !!document.querySelector("form"),
    h1: document.querySelector("h1")?.textContent?.trim() || null,
  })).catch(() => null);

  const uniq = {};
  for (const f of failed) if (!uniq[f.url]) uniq[f.url] = f.status;
  console.log(`\n[${PASS}] homepage load=${loadMs}ms`);
  console.log(`  state after clicking navbar Get started: ${JSON.stringify(state)}`);
  console.log(`  failed (>=400) unique: ${failed.length} total, ${Object.keys(uniq).length} unique`);
  for (const [u, s] of Object.entries(uniq)) console.log(`    ${s} ${u}`);
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
