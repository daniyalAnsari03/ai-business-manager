import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";
const pick = (re) => (fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").match(re) || [])[1]?.trim();
const creds = { email: pick(/Email\s*[:=]\s*(.+)/i), password: pick(/Password\s*[:=]\s*(.+)/i) };

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "load" });
await page.waitForSelector("#login-email");
await page.fill("#login-email", creds.email);
await page.fill("#login-password", creds.password);
await page.click('form button[type="submit"]');
await page.waitForTimeout(3000);
await page.goto(`${BASE}/dashboard/assistant`, { waitUntil: "load" });
await page.waitForSelector("#ai-chat-input");
await page.waitForTimeout(600);

async function dumpTree(width) {
  await page.setViewportSize({ width, height: 780 });
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => {
    const dump = (el, depth) => {
      if (!el || depth > 6) return [];
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const rows = [];
      const cls = String(el.className || "");
      const interesting =
        /chat-scroll|space-y|welcome|empty|hint|flex-col|min-h|btn|question|sample|chip/i.test(cls);
      if (interesting || depth <= 3) {
        rows.push(
          `${"  ".repeat(depth)}<${el.tagName.toLowerCase()}> h=${Math.round(r.height)} y=${Math.round(r.y)} flex=${cs.flex} minH=${cs.minHeight} overY=${cs.overflowY} ${cls.slice(0, 70)}`,
        );
      }
      for (const c of el.children) rows.push(...dump(c, depth + 1));
      return rows;
    };
    const scroll = document.querySelector(".chat-scrollbar, [class*='chat-scroll']");
    return dump(scroll || document.querySelector("main"), 0);
  });
  console.log(`\n===== at ${width}x780 (scroll content tree) =====`);
  for (const l of out) console.log(l);
}

await dumpTree(375);
await dumpTree(320);

await ctx.close();
await browser.close();