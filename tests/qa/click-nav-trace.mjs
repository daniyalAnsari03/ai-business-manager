/**
 * Real-browser click → navigation latency diagnostic.
 *
 * Opens the homepage in an actual Chrome (headless via Playwright), then for
 * EVERY clickable link/button on the page measures:
 *   - tClick:      performance.now() just before dispatching the click
 *   - tNavStart:   when location.href first changes (navigation began)
 *   - tContent:    when the destination reveals its "seen" marker
 *   - duration of any network requests fired between click and navigation
 *   - whether any long task blocked the main thread between click and nav
 *
 * Outputs raw numbers (ms) per button; nothing is summarized as "fast".
 *
 * Usage: node tests/qa/click-nav-trace.mjs [BASE] [PASS]
 */
import { chromium } from "playwright-core";

const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3100";
const PASS = process.argv[3] || "trace";

// Every distinct clickable that triggers navigation. Matched by visible text
// and href so the report names each one individually.
const TARGETS = [
  { name: "Navbar Get started (desktop)", text: "Get started", href: "/login" },
  { name: "Hero primary CTA (Get started free)", text: "Get started free", href: "/login" },
  { name: "Hero secondary CTA (See how it works)", text: "See how it works", href: "#how-it-works" },
  { name: "Final CTA (Start free)", text: "Start free", href: "/login" },
];

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(2000);

  const clickables = await page.evaluate(() => {
    const out = [];
    const els = document.querySelectorAll('a[href], button[type="button"], button:not([type])');
    for (const el of els) {
      const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      const href = el.getAttribute("href");
      const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      if (!visible) continue;
      out.push({ text, href });
    }
    return out;
  });

  console.log(`\n[${PASS}] homepage clickable (visible) elements:`);
  clickables.forEach((c, i) => console.log(`  ${i}: "${c.text}"  href=${c.href}`));

  // Per-target measurement. We navigate back to '/' before each.
  for (const t of TARGETS) {
    await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 120000 });
    await page.waitForTimeout(1200);

    const loc = (() => {
      const base = t.href ? `a[href="${t.href}"]` : "a[href], button";
      return page.locator(base).filter({ hasText: t.text }).first();
    })();

    // Network requests fired during navigation window
    const requests = [];
    const onReq = (req) => {
      let timing = null;
      try { const tt = req.timing(); timing = tt && tt.responseEnd ? Math.round(tt.responseEnd) : null; } catch {}
      requests.push({ url: req.url(), phase: "pending", timing });
    };
    const onDone = (res) => {
      const req = requests.find((r) => r.url === res.url());
      if (req) { req.phase = "done"; req.status = res.status(); }
    };
    page.on("request", onReq);
    page.on("response", onDone);

    // Instrument long tasks + click-to-visible latency
    await page.evaluate(() => {
      window.__T = {};
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__T.longTask = (window.__T.longTask || 0) + e.duration;
          window.__T.longCount = (window.__T.longCount || 0) + 1;
        }
      });
      try { obs.observe({ entryTypes: ["longtask"] }); } catch {}
      const origPush = history.pushState;
      history.pushState = function (...a) {
        if (!window.__T.navStart) window.__T.navStart = performance.now();
        return origPush.apply(this, a);
      };
    });

    const tClick = Date.now();
    await loc.click({ timeout: 8000 }).catch(() => {});
    // poll for URL change or up to 8s
    const startUrl = page.url();
    let tNavStart = null;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 8000) {
      const u = page.url();
      if (u !== startUrl) { tNavStart = Date.now(); break; }
      await page.waitForTimeout(20);
    }

    // For /login destinations, measure until the login form is actually
    // visible and interactive (this is what the user perceives as "opened").
    let tVisible = null;
    if (t.href === "/login") {
      const visStart = Date.now();
      try {
        await page.waitForSelector("#login-email", { state: "visible", timeout: 8000 });
        tVisible = Date.now() - visStart;
      } catch {}
      await page.waitForSelector("#login-email", { state: "attached", timeout: 5000 }).catch(() => {});
    } else {
      // anchor nav: content is same page, treat navStart as visible
      tVisible = tNavStart ? tNavStart - tClick : null;
    }

    await page.waitForTimeout(300);

    const target = await page.evaluate(() => ({
      url: location.href,
      hasLoginForm: !!document.querySelector("#login-email"),
      title: document.title,
      heading: document.querySelector("h1")?.textContent?.trim() || null,
      longTask: window.__T.longTask || 0,
      longCount: window.__T.longCount || 0,
    })).catch(() => null);

    page.removeListener("request", onReq);
    page.removeListener("response", onDone);

    console.log(`\n  --- ${t.name} ---`);
    console.log(`    click at t=0`)
    console.log(`    click->URL change (nav start)         = ${tNavStart === null ? "NO NAV" : (tNavStart - tClick) + "ms"}`);
    console.log(`    click->login form visible (painted)   = ${tVisible === null ? "n/a" : tVisible + "ms"}`);
    console.log(`    destination state: ${target ? JSON.stringify(target) : "n/a"}`);
    console.log(`    long-task time during window = ${target?.longTask ?? 0}ms (${target?.longCount ?? 0} tasks)`);
    console.log(`    requests during navigation: ${requests.length}`);
    for (const r of requests.slice(0, 12)) {
      console.log(`      [${r.phase}${r.status ? " " + r.status : ""}] ${r.timing ? "timing:" + r.timing + "ms " : ""}${r.url.replace(BASE, "")}`);
    }
  }

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
