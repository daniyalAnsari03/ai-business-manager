import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";

function readCreds() {
  const text = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  const pick = (re) => (text.match(re) || [])[1]?.trim();
  return { email: pick(/Email\s*[:=]\s*(.+)/i), password: pick(/Password\s*[:=]\s*(.+)/i) };
}
const creds = readCreds();

const browser = await chromium.launch({ executablePath: EXE, headless: true });

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.waitForSelector("#login-email");
  await page.fill("#login-email", creds.email);
  await page.fill("#login-password", creds.password);
  await page.click('form button[type="submit"]');
  await page.waitForTimeout(3000);
  await page.goto(`${BASE}/dashboard/assistant`, { waitUntil: "load" });
  await page.waitForSelector("#ai-chat-input");
  await page.waitForTimeout(600);
}

async function snapshot(page, label) {
  const d = await page.evaluate((lbl) => {
    const form = document.querySelector("form:has(#ai-chat-input)");
    const dis = form ? form.nextElementSibling : null;
    const f = form ? form.getBoundingClientRect() : null;
    const p = dis ? dis.getBoundingClientRect() : null;
    return {
      label: lbl,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      outerW: window.outerWidth,
      outerH: window.outerHeight,
      screenH: window.screen.height,
      clientH: document.documentElement.clientHeight,
      scrollH: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
      dpr: window.devicePixelRatio,
      statusBar: window.visualViewport ? window.visualViewport.height : null,
      dvh: (() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;left:-9999px;width:1px;height:100dvh"; document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h; })(),
      svh: (() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;left:-9999px;width:1px;height:100svh"; document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h; })(),
      formBottom: f ? Math.round(f.bottom) : null,
      helperY: p ? Math.round(p.y) : null,
      helperBottom: p ? Math.round(p.bottom) : null,
    };
  });
  console.log(label, JSON.stringify(d));
}

// Desktop exact repro
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);
  for (const w of [1024, 1280, 1440]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(400);
    await snapshot(page, `DESKTOP set ${w}x800`);
  }
  await ctx.close();
}

// Mobile exact repro
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signIn(page);
  for (const w of [320, 360, 375, 390, 414]) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(400);
    await snapshot(page, `MOBILE set ${w}x780`);
  }
  await ctx.close();
}

// Mobile fresh-at-320 vs resized-to-320
{
  const ctx = await browser.newContext({ viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signIn(page);
  await snapshot(page, "MOBILE FRESH 320x780");
  for (const w of [375, 390, 320]) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(400);
    await snapshot(page, `MOBILE resize ${w}x780`);
  }
  // resize down then back up
  await page.setViewportSize({ width: 320, height: 667 });
  await page.waitForTimeout(400);
  await snapshot(page, "MOBILE resize 320x667 (short)");
  await ctx.close();
}

await browser.close();