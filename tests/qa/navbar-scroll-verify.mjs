import { chromium } from "playwright-core";

const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3000";
const PASS = process.argv[3] || "dev";

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  for (const label of ["desktop", "mobile"]) {
    const ctx = await browser.newContext({
      viewport: label === "desktop" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
      isMobile: label === "mobile",
      hasTouch: label === "mobile",
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 120000 });
    await page.waitForTimeout(1500);

    const headerInfo = await page.evaluate(() => {
      const h = document.querySelector("header");
      const cs = getComputedStyle(h);
      return { position: cs.position, top: cs.top, zIndex: cs.zIndex };
    });

    const samples = [];
    const totalH = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    const marks = [0, 0.05, 0.2, 0.4, 0.6, 0.8, 1];
    for (const frac of [...marks, ...marks.slice().reverse(), 0.5]) {
      const y = Math.round(totalH * frac);
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(90);
      const s = await page.evaluate(() => {
        const h = document.querySelector("header");
        const r = h.getBoundingClientRect();
        // sticky pinned means top is ~0 and it's within viewport
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, stuck: Math.round(r.top) === 0 };
      });
      samples.push({ y: Math.round(y), frac, ...s });
    }

    const allStuck = samples.every((s) => s.stuck);
    console.log(`\n[${PASS}/${label}] header=${JSON.stringify(headerInfo)}`);
    console.log(`  totalScrollH=${Math.round(totalH)}px  samples=${samples.length}`);
    for (const s of samples) console.log(`    frac=${s.frac.toFixed(2)} y=${s.y} headerTop=${s.top} headerBottom=${s.bottom} stuck=${s.stuck}`);
    console.log(`  RESULT: navbar visible&stuck at every scroll position = ${allStuck}`);
    await ctx.close();
  }
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
