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

const dump = async (label) => {
  const data = await page.evaluate(() => {
    const form = document.querySelector("form:has(#ai-chat-input)");
    const dis = form ? form.nextElementSibling : null;
    const scrollArea = document.querySelector("div.chat-scrollbar");
    const card = form ? form.parentElement : null;
    const r = (el) => el ? ({ y: el.getBoundingClientRect().y, h: el.getBoundingClientRect().height, b: el.getBoundingClientRect().bottom, w: el.getBoundingClientRect().width, r: el.getBoundingClientRect().right }) : null;
    const col = (el) => el ? ({ h: el.clientHeight, sh: el.scrollHeight, st: el.scrollTop, oh: el.offsetHeight }) : null;
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      form: r(form), dis: r(dis), scrollArea: r(scrollArea),
      formCol: col(form), scrollAreaCol: col(scrollArea), cardCol: col(card),
      disText: dis ? dis.textContent : null,
      bodyScrollH: document.body.scrollHeight,
      docScrollH: document.documentElement.scrollHeight,
    };
  });
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(data, null, 2));
};

await dump("initial (New Chat)");

// open long conversation via + menu -> Chat History -> first item
const form = page.locator("form:has(#ai-chat-input)");
await form.locator("button").nth(4).click();
await page.waitForSelector('[role="menu"]', { timeout: 8000 });
await page.locator('[role="menu"] [role="menuitem"]').first().click();
await page.waitForTimeout(1200);
const drawer = page.locator("div.absolute.inset-y-0.left-0.flex.w-\\[17rem\\]");
const items = drawer.locator('[role="button"]');
console.log("conversation count in drawer:", await items.count());
await items.first().click();
await page.waitForTimeout(1500);
const msgCount = await page.locator("ul.space-y-5 > li").count();
console.log("long conversation message count:", msgCount);
await dump("long conversation loaded");

// send a message
await page.fill("#ai-chat-input", "diag stability check send");
await page.click('form button[type="submit"]');
await page.waitForTimeout(11000);
await dump("after send");
const msgCount2 = await page.locator("ul.space-y-5 > li").count();
console.log("after send message count:", msgCount2);

await browser.close();
console.log("DONE");
