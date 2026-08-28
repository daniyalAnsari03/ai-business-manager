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

async function dumpHeights(width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => {
    const q = (n) => {
      const el = document.querySelector(n);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { t: Math.round(r.y), h: Math.round(r.height) };
    };
    const form = document.querySelector("form:has(#ai-chat-input)");
    const sel = (el) => {
      const path = [];
      let cur = el;
      while (cur && cur !== document.body) {
        path.unshift(cur.tagName + (cur.className && typeof cur.className === "string" ? "." + cur.className.split(" ").slice(0, 4).join(".") : ""));
        cur = cur.parentElement;
      }
      return path.join(" < ");
    };
    return {
      root: q("div[class*='h-dvh']"),
      docScrollH: document.documentElement.scrollHeight,
      content: q("div[class*='h-full'][class*='lg\\:pl-64']"),
      main: q("main"),
      pageRoot: q("main > div"),
      card: q(".card-surface"),
      scroll: q("[class*='chat-scroll']"),
      emptyWrap: q("div[class*='min-h-full']"),
      formBottom: form ? Math.round(form.getBoundingClientRect().bottom) : null,
      formPath: form ? sel(form) : null,
    };
  });
  console.log(`\n===== ${width}x${height} =====`);
  for (const [k, v] of Object.entries(out)) if (v && typeof v !== "string") console.log(k, JSON.stringify(v));
  else if (v) console.log(k, v);
}

await dumpHeights(375, 780);
await dumpHeights(320, 780);
await dumpHeights(320, 667);

await ctx.close();
await browser.close();