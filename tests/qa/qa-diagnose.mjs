import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";

function readCreds() {
  const text = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  const pick = (re) => {
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };
  return { email: pick(/Email\s*[:=]\s*(.+)/i), password: pick(/Password\s*[:=]\s*(.+)/i) };
}
const creds = readCreds();

async function dump(label, page) {
  const info = await page.evaluate(() => {
    const sel = (q) => {
      const el = document.querySelector(q);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        cls: String(el.className).slice(0, 90),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        overflow: cs.overflow,
        overflowY: cs.overflowY,
        display: cs.display,
        position: cs.position,
        flex: cs.flex,
        minH: cs.minHeight,
        maxH: cs.maxHeight,
        h: cs.height,
      };
    };
    return {
      scrollY: window.scrollY,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      docClientH: document.documentElement.clientHeight,
      docScrollH: document.documentElement.scrollHeight,
      bodyScrollH: document.body.scrollHeight,
      root: sel("#__next > div"),
      content: sel("#__next > div > div:nth-child(3)"),
      main: sel("main"),
      pageRoot: sel("main > div"),
      card: sel(".card-surface"),
      scrollArea: sel(".chat-scrollbar"),
      voicWrap: sel(".card-surface > div.shrink-0.overflow-hidden"),
      form: sel("form:has(#ai-chat-input)"),
      dis: sel("form:has(#ai-chat-input) + p"),
    };
  });
  console.log(`\n===== ${label} =====`);
  console.log("scrollY", info.scrollY, "inner", info.innerW + "x" + info.innerH, "docClientH", info.docClientH, "docScrollH", info.docScrollH, "bodyScrollH", info.bodyScrollH);
  for (const [k, v] of Object.entries(info)) {
    if (k === "scrollY" || k === "innerW" || k === "innerH" || k === "docClientH" || k === "docScrollH" || k === "bodyScrollH") continue;
    console.log(k.padEnd(11), v ? `${JSON.stringify(v)}` : "(none)");
  }
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });

// Desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.waitForSelector("#login-email");
  await page.fill("#login-email", creds.email);
  await page.fill("#login-password", creds.password);
  await page.click('form button[type="submit"]');
  await page.waitForTimeout(3000);
  await page.goto(`${BASE}/dashboard/assistant`, { waitUntil: "load" });
  await page.waitForSelector("#ai-chat-input");
  await page.waitForTimeout(800);
  await dump("DESKTOP 1440x900 new chat", page);
  await ctx.close();
}

// Mobile
{
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
  await page.waitForTimeout(800);
  await dump("MOBILE 390 new chat", page);
  // Open the long conversation to reproduce "pushed down" bug
  await page.locator("form:has(#ai-chat-input) button").nth(4).click();
  await page.waitForSelector('[role="menu"]');
  await page.locator('[role="menu"] [role="menuitem"]').first().click();
  await page.waitForTimeout(800);
  const panel = page.locator("div.absolute.inset-y-0.left-0.flex.w-\\[17rem\\]");
  await panel.locator('[role="button"]').first().click();
  await page.waitForTimeout(1800);
  await dump("MOBILE 390 long conversation loaded", page);
  await ctx.close();
}

await browser.close();