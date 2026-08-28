import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";

function readCreds() {
  const text = fs.readFileSync(path.join("D:\\AI-Business-Manager", ".env.local"), "utf8");
  const pick = (re) => {
    const m = text.match(re);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  };
  return { email: pick(/Email\s*[:=]\s*(.+)/i), password: pick(/Password\s*[:=]\s*(.+)/i) };
}
const creds = readCreds();

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120000 });
await page.waitForSelector("#login-email", { timeout: 60000 });
await page.fill("#login-email", creds.email);
await page.fill("#login-password", creds.password);
await page.click('form button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.goto(`${BASE}/dashboard/assistant`, { waitUntil: "load", timeout: 120000 });
await page.waitForSelector("#ai-chat-input", { timeout: 60000 });
await page.waitForTimeout(600);

const trace = async (label) => {
  console.log(`\n===== ${label} =====`);
  const rows = await page.evaluate(() => {
    const form = document.querySelector("form:has(#ai-chat-input)");
    const card = form ? form.parentElement : null;
    let el = card;
    let depth = 0;
    const out = [];
    while (el && depth < 12) {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out.push({
        depth,
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === "string" ? String(el.className) : "",
        y: Math.round(b.y), h: Math.round(b.height), b: Math.round(b.bottom),
        display: cs.display, dir: cs.flexDirection, grow: cs.flexGrow, shrink: cs.flexShrink, basis: cs.flexBasis,
        minH: cs.minHeight, maxH: cs.maxHeight, overflow: cs.overflow, overflowY: cs.overflowY,
        clientH: el.clientHeight, scrollH: el.scrollHeight,
        tagName: el.tagName,
      });
      el = el.parentElement;
      depth++;
    }
    return out;
  });
  for (const r of rows) {
    console.log(`[${r.depth}] <${r.tag}${r.cls ? "." + r.cls.split(" ").join(".") : ""}> y=${r.y} h=${r.h} b=${r.b} ${r.display} ${r.dir ? "dir=" + r.dir : ""} grow=${r.grow} shrink=${r.shrink} basis=${r.basis} minH=${r.minH} maxH=${r.maxH} over=${r.overflow}/${r.overflowY} clH=${r.clientH} scH=${r.scrollH}`);
  }
};

await trace("New Chat");
// open long conversation
const form = page.locator("form:has(#ai-chat-input)");
await form.locator("button").nth(4).click();
await page.waitForSelector('[role="menu"]', { timeout: 8000 });
await page.locator('[role="menu"] [role="menuitem"]').first().click();
await page.waitForTimeout(1200);
const drawer = page.locator("div.absolute.inset-y-0.left-0.flex.w-\\[17rem\\]");
await drawer.locator('[role="button"]').first().click();
await page.waitForTimeout(1500);
await trace("Long conversation loaded");

// Now test switching to New Chat again (empty) to compare
await form.locator("button").nth(4).click();
await page.waitForSelector('[role="menu"]', { timeout: 8000 });
await page.locator('[role="menu"] [role="menuitem"]').first().click();
await page.waitForTimeout(800);
const drawer2 = page.locator("div.absolute.inset-y-0.left-0.flex.w-\\[17rem\\]");
await drawer2.locator("button", { hasText: /Naya chat|New chat/ }).click();
await page.waitForTimeout(900);
await trace("Back to New Chat");

await browser.close();
console.log("\nDONE");
