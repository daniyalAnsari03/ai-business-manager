/**
 * Browser QA for docs/css.txt — mobile chat composer & responsive UX fixes.
 *
 * Signs into the REAL account (credentials parsed from .env.local
 * "Email: / Password:" lines), then validates the AI Manager composer on:
 *   Desktop: 1024 / 1280 / 1440
 *   Mobile:  320 / 360 / 375 / 390 / 414
 *
 * Covers: action layout/order, rights/visibility, placeholder, helper text,
 * "+" menu staying inside the viewport, image upload via "+", New Chat vs
 * long-conversation composer stability, conversation switching, send
 * stability, resize transitions and horizontal overflow.
 *
 * Usage: node qa-composer.mjs [BASE_URL]
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3000";
const PLACEHOLDER = "AI se puchein\u2026";

function readCreds() {
  const text = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  const pick = (re) => {
    const m = text.match(re);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  };
  return {
    email: pick(/Email\s*[:=]\s*(.+)/i),
    password: pick(/Password\s*[:=]\s*(.+)/i),
  };
}

const results = [];
const failures = [];
function report(name, pass, detail = "") {
  results.push({ name, pass, detail });
  const line = `  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`;
  console.log(line);
  if (!pass) failures.push(line);
}

function inViewport(rect, vw, vh) {
  if (!rect) return false;
  const x = rect.x ?? rect.left;
  const y = rect.y ?? rect.top;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return (
    x >= -0.5 &&
    y >= -0.5 &&
    x + rect.width <= vw + 0.5 &&
    y + rect.height <= vh + 0.5
  );
}

async function metrics(page) {
  return page.evaluate(() => ({
    vw: window.innerWidth,
    vh: window.innerHeight,
    docScrollW: document.documentElement.scrollWidth,
  }));
}

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120000 });
  await page.waitForSelector("#login-email", { timeout: 60000 });
  await page.fill("#login-email", creds.email);
  await page.fill("#login-password", creds.password);
  await page.click('form button[type="submit"]');
  await page
    .waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
}

async function gotoAssistant(page) {
  await page.goto(`${BASE}/dashboard/assistant`, { waitUntil: "load", timeout: 120000 });
  await page.waitForSelector("#ai-chat-input", { timeout: 60000 });
  await page.waitForTimeout(600);
}

async function composerState(page, label) {
  const form = page.locator("form:has(#ai-chat-input)");
  const textarea = page.locator("#ai-chat-input");
  const dis = page.locator("form:has(#ai-chat-input) + p");
  const btns = form.locator("button");

  const box = async (loc) => {
    try {
      return await loc.boundingBox();
    } catch {
      return null;
    }
  };
  const vis = async (loc) => loc.isVisible().catch(() => false);

  const fBox = await box(form);
  const iBox = await box(textarea);
  const dBox = await box(dis);
  const vBox = await box(btns.nth(0));
  const hBox = await box(btns.nth(1));
  const imBox = await box(btns.nth(2));
  const sBox = await box(btns.nth(3));
  const pBox = await box(btns.nth(4));
  const { vw, vh, docScrollW } = await metrics(page);

  return {
    label,
    vw,
    vh,
    fBox,
    iBox,
    dBox,
    vBox,
    hBox,
    imBox,
    sBox,
    pBox,
    voiceVisible: await vis(btns.nth(0)),
    historyVisible: await vis(btns.nth(1)),
    imageVisible: await vis(btns.nth(2)),
    sendVisible: await vis(btns.nth(3)),
    plusVisible: await vis(btns.nth(4)),
    placeholder: await textarea.getAttribute("placeholder").catch(() => null),
    hOverflow: docScrollW > vw,
  };
}

async function verifyDesktop(c, width) {
  const where = `desktop ${width}px`;
  report(`${where} input visible`, c && c.iBox !== null);
  report(`${where} Voice separate button`, c.voiceVisible);
  report(`${where} Chat History separate button`, c.historyVisible);
  report(`${where} Image Upload separate button`, c.imageVisible);
  report(`${where} "+" hidden`, !c.plusVisible);
  report(`${where} Send visible`, c.sendVisible);
  if (c.iBox && c.vBox && c.hBox && c.imBox && c.sBox) {
    const order =
      c.vBox.x >= c.iBox.x + c.iBox.width - 1 &&
      c.hBox.x >= c.vBox.x &&
      c.imBox.x >= c.hBox.x &&
      c.sBox.x >= c.imBox.x;
    report(`${where} action order Input->Voice->History->Image->Send`, order);
  }
  const dDetail = (box) => box
    ? `y=${Math.round(box.y)} b=${Math.round(box.y + box.height)} r=${Math.round(box.x + box.width)} vw=${c.vw} vh=${c.vh}`
    : "null";
  report(`${where} helper text visible`, c && c.dBox && inViewport(c.dBox, c.vw, c.vh), dDetail(c.dBox));
  report(`${where} helper directly below input`, c && c.fBox && c.dBox && c.dBox.y >= c.fBox.y + c.fBox.height - 2);
  report(`${where} placeholder = "${PLACEHOLDER}"`, c && c.placeholder === PLACEHOLDER, c.placeholder);
  report(`${where} composer in viewport`, c && c.fBox && inViewport(c.fBox, c.vw, c.vh), `y=${c.fBox ? Math.round(c.fBox.y) : "?"} b=${c.fBox ? Math.round(c.fBox.y + c.fBox.height) : "?"} r=${c.fBox ? Math.round(c.fBox.x + c.fBox.width) : "?"} vw=${c.vw} vh=${c.vh}`);
  report(`${where} no horizontal overflow`, c && !c.hOverflow);
}

async function verifyMobile(c, width) {
  const where = `mobile ${width}px`;
  report(`${where} input visible`, c && c.iBox !== null);
  report(`${where} Voice visible`, c.voiceVisible);
  report(`${where} Chat History hidden (inside +)`, !c.historyVisible);
  report(`${where} Image Upload hidden (inside +)`, !c.imageVisible);
  report(`${where} "+" visible`, c.plusVisible);
  report(
    `${where} "+" is rightmost action`,
    Boolean(c.pBox && c.sBox && c.pBox.x + c.pBox.width >= c.sBox.x + c.sBox.width - 1),
    c.pBox && c.sBox
      ? `+right=${Math.round(c.pBox.x + c.pBox.width)} sendRight=${Math.round(c.sBox.x + c.sBox.width)}`
      : "",
  );
  report(
    `${where} Voice directly beside input`,
    Boolean(c.iBox && c.vBox && c.vBox.x >= c.iBox.x + c.iBox.width - 1 && c.vBox.x - (c.iBox.x + c.iBox.width) <= 20),
  );
  report(`${where} width budget OK (input usable)`, Boolean(c.iBox && c.iBox.width >= 80), c.iBox ? `${Math.round(c.iBox.width)}px` : "");
  report(`${where} placeholder = "${PLACEHOLDER}"`, c && c.placeholder === PLACEHOLDER, c.placeholder);
  report(`${where} helper text visible on mobile`, c && c.dBox && inViewport(c.dBox, c.vw, c.vh), c.dBox ? `y=${Math.round(c.dBox.y)}` : "");
  report(`${where} helper directly below input`, c && c.fBox && c.dBox && c.dBox.y >= c.fBox.y + c.fBox.height - 2);
  report(`${where} composer in viewport`, c && c.fBox && inViewport(c.fBox, c.vw, c.vh));
  report(`${where} no horizontal overflow`, c && !c.hOverflow);
}

const placeholderPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function testPlusMenu(page, width) {
  const where = `mobile ${width}px +menu`;
  const form = page.locator("form:has(#ai-chat-input)");
  const toggle = form.locator("button").nth(4);
  const { vw, vh } = await metrics(page);

  await toggle.click();
  await page.waitForSelector('[role="menu"]', { timeout: 8000 });
  await page.waitForTimeout(350);

  let menu = page.locator('[role="menu"]').last();
  const mBox = await menu.boundingBox();
  report(`${where} opens`, mBox !== null);
  report(
    `${where} stays fully inside viewport`,
    Boolean(mBox && inViewport(mBox, vw, vh)),
    mBox
      ? `top=${Math.round(mBox.y)} right=${Math.round(mBox.x + mBox.width)} bottom=${Math.round(mBox.y + mBox.height)}`
      : "",
  );
  const itemCount = await menu.locator('[role="menuitem"]').count();
  report(`${where} has 2 items (Chat History + Image Upload)`, itemCount === 2, `items=${itemCount}`);
  report(`${where} menu text labels present`, (await menu.locator('[role="menuitem"]').allTextContents()).every((s) => s.trim().length > 0));

  // Image Upload via "+" menu -> file chooser -> preview appears.
  let imageOk = false;
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 8000 }),
      menu.locator('[role="menuitem"]').nth(1).click(),
    ]);
    await chooser.setFiles({
      name: "qa.png",
      mimeType: "image/png",
      buffer: placeholderPng,
    });
    await page.waitForSelector('img[alt="Attached image"]', { timeout: 8000 });
    imageOk = true;
  } catch (e) {
    imageOk = false;
  }
  report(`${where} Image Upload works via menu`, imageOk);
  // Reset pending image by reloading.
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#ai-chat-input", { timeout: 60000 });
  await page.waitForTimeout(500);

  // Close by tapping outside.
  await page.mouse.click(Math.max(2, vw - 24), 2);
  await page.waitForTimeout(250);
  report(`${where} closes on outside tap`, (await page.locator('[role="menu"]').count()) === 0);

  // Reopen via toggle.
  await toggle.click();
  await page.waitForSelector('[role="menu"]', { timeout: 8000 });
  await page.waitForTimeout(350);
  menu = page.locator('[role="menu"]').last();
  const m2 = await menu.boundingBox();
  report(`${where} reopens on second tap`, Boolean(m2 && inViewport(m2, vw, vh)), m2 ? `right=${Math.round(m2.x + m2.width)}` : "");

  // Close via Escape.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  report(`${where} closes on Escape`, (await page.locator('[role="menu"]').count()) === 0);

  report(`${where} composer usable after close`, await page.locator("#ai-chat-input").isVisible());

  report(`${where} no horizontal overflow after menu use`, (await metrics(page)).docScrollW <= (await metrics(page)).vw);
}

/* Visible mobile history drawer (desktop overlay is hidden via CSS but still in DOM). */
async function openDrawerFromPlus(page) {
  await page.locator("form:has(#ai-chat-input) button").nth(4).click();
  await page.waitForSelector('[role="menu"]', { timeout: 8000 });
  await page.locator('[role="menu"] [role="menuitem"]').first().click(); // Chat History
  await page.waitForTimeout(700);
  return page.locator("div.absolute.inset-y-0.left-0.flex.w-\\[17rem\\]");
}

async function pickConversation(page, indexFromTop) {
  const drawerPanel = await openDrawerFromPlus(page);
  const items = drawerPanel.locator('[role="button"]');
  const n = await items.count();
  const idx = indexFromTop < n ? indexFromTop : 0;
  await items.nth(idx).click();
  await page.waitForTimeout(1500);
}

async function startNewChat(page) {
  const drawerPanel = await openDrawerFromPlus(page);
  await drawerPanel.locator("button", { hasText: /Naya chat|New chat/ }).click();
  await page.waitForTimeout(900);
}

async function countMessages(page) {
  return page.locator("ul.space-y-5 > li").count();
}

const creds = readCreds();
if (!creds.email || !creds.password) {
  console.error("Missing Email:/Password: in .env.local");
  process.exit(2);
}

console.log(`QA composer browser test  base=${BASE}  user=${creds.email}`);
console.log("---------------------------------------------------------------");

const browser = await chromium.launch({ executablePath: EXE, headless: true });

/* ================= Desktop matrix ================= */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page);
  await gotoAssistant(page);
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(400);
    const c = await composerState(page);
    await verifyDesktop(c, width);
  }
  await ctx.close();
}

/* ================= Mobile matrix ================= */
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await signIn(page);
  await gotoAssistant(page);

  for (const width of [320, 360, 375, 390, 414]) {
    await page.setViewportSize({ width, height: 780 });
    await page.waitForTimeout(400);
    const c = await composerState(page, width);
    await verifyMobile(c, width);
    await testPlusMenu(page, width);
  }

  /* ---- New Chat vs long conversation composer stability ---- */
  const where = "mobile 390px composer stability";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);

  // Test A: New Chat
  await startNewChat(page);
  const newChatState = await composerState(page);
  report(`${where} New Chat composer fully visible`, newChatState.fBox && inViewport(newChatState.fBox, newChatState.vw, newChatState.vh));
  report(`${where} New Chat helper visible`, newChatState.dBox && inViewport(newChatState.dBox, newChatState.vw, newChatState.vh));
  report(`${where} New Chat empty state`, (await countMessages(page)) === 0);

  // Test B: open the LONG conversation (first item = 12 seeded messages).
  await pickConversation(page, 0);
  const longState = await composerState(page);
  const msgN = await countMessages(page);
  report(`${where} Long conversation opened`, msgN >= 8, `messages=${msgN}`);
  report(`${where} Long conversation composer fully visible`, longState.fBox && inViewport(longState.fBox, longState.vw, longState.vh));
  report(`${where} Long conversation Voice + "+" visible`, longState.voiceVisible && longState.plusVisible);
  report(`${where} Long conversation helper visible`, longState.dBox && inViewport(longState.dBox, longState.vw, longState.vh), longState.dBox ? `y=${Math.round(longState.dBox.y)}` : "");
  report(
    `${where} same bottom anchor as New Chat`,
    Boolean(newChatState.fBox && longState.fBox && Math.abs(newChatState.fBox.y + newChatState.fBox.height - (longState.fBox.y + longState.fBox.height)) < 6),
    newChatState.fBox && longState.fBox
      ? `newBottom=${Math.round(newChatState.fBox.y + newChatState.fBox.height)} longBottom=${Math.round(longState.fBox.y + longState.fBox.height)}`
      : "",
  );

  // Send a message in the long conversation; composer must stay stable.
  const msgsBefore = await countMessages(page);
  await page.fill("#ai-chat-input", "browser qa stability send");
  await page.click('form button[type="submit"]');
  await page.waitForTimeout(10000);
  const msgsAfter = await countMessages(page);
  report(`${where} message sent`, msgsAfter === msgsBefore + 2, `before=${msgsBefore} after=${msgsAfter}`);
  const afterSend = await composerState(page);
  report(`${where} composer stable after send`, afterSend.fBox && inViewport(afterSend.fBox, afterSend.vw, afterSend.vh));
  report(`${where} helper still visible after send`, afterSend.dBox && inViewport(afterSend.dBox, afterSend.vw, afterSend.vh));

  // Test C: switch conversations.
  await pickConversation(page, 1);
  const swState = await composerState(page);
  report(`${where} switch to another conversation — composer visible`, swState.fBox && inViewport(swState.fBox, swState.vw, swState.vh));
  report(`${where} switched conversation helper visible`, swState.dBox && inViewport(swState.dBox, swState.vw, swState.vh));

  // Back to New Chat.
  await startNewChat(page);
  const backNew = await composerState(page);
  report(`${where} back to New Chat — composer stable`, backNew.fBox && inViewport(backNew.fBox, backNew.vw, backNew.vh));

  // Resize mobile -> desktop -> mobile.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(500);
  const dC = await composerState(page);
  verifyDesktop(dC, 1280);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const mC = await composerState(page);
  report(`${where} back to mobile shows Voice + "+" only`, mC.voiceVisible && mC.plusVisible && !mC.historyVisible && !mC.imageVisible);

  await ctx.close();
}

await browser.close();

console.log("---------------------------------------------------------------");
console.log(`SUMMARY: ${results.filter((r) => r.pass).length}/${results.length} passed`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(f);
  process.exit(1);
}