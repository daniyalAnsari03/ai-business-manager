/**
 * Authenticated performance audit against the REAL account (browser-level).
 *
 * Measures actual click-to-visible-content and page-load timings for every
 * dashboard sidebar route on desktop AND mobile, plus major interactive
 * actions (create dialogs, AI assistant latency).
 *
 * Usage:
 *   $env:PERF_EMAIL="..." ; $env:PERF_PASSWORD="..." ; node --env-file=.env.local tests/qa/perf-audit.mjs
 *
 * Env knobs:
 *   PERF_EMAIL / PERF_PASSWORD  real account credentials (required)
 *   PERF_BASE_URL               app base URL (default http://localhost:3100)
 *   PERF_BROWSER                chrome | msedge (default chrome)
 *   PERF_PASS                   label for this run, e.g. before/after (required)
 *   PERF_OUT                    output JSON file (default tests/qa/perf-results.json)
 *   PERF_COLD                   "0" to skip cold-load pass (default on)
 *   PERF_WARM                   "0" to skip sidebar-click pass (default on)
 *   PERF_AI                     "0" to skip AI assistant latency (default on)
 *   PERF_MODALS                 "0" to skip dialog-open pass (default on)
 *
 * This tool only READS business data. It creates no records and signs no
 * release beyond its own measurement logging. No secrets are written to
 * output files.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EMAIL = process.env.PERF_EMAIL || process.env.QA_EMAIL;
const PASSWORD = process.env.PERF_PASSWORD || process.env.QA_PASSWORD;
const BASE_URL = process.env.PERF_BASE_URL || "http://localhost:3100";
const BROWSER = process.env.PERF_BROWSER || "chrome";
const PASS = process.env.PERF_PASS || "run";
const RESULTS_FILE =
  process.env.PERF_OUT || path.join(__dirname, "perf-results.json");
const RUN_COLD = process.env.PERF_COLD !== "0";
const RUN_WARM = process.env.PERF_WARM !== "0";
const RUN_AI = process.env.PERF_AI !== "0";
const RUN_MODALS = process.env.PERF_MODALS !== "0";

if (!EMAIL || !PASSWORD) {
  console.error(
    "PERF_EMAIL and PERF_PASSWORD (or QA_EMAIL/QA_PASSWORD) must be set.",
  );
  process.exit(2);
}

const EXE = {
  chrome: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  msedge: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
}[BROWSER];

const ROUTES = [
  { path: "/dashboard", name: "dashboard", kind: "h1" },
  { path: "/dashboard/assistant", name: "assistant", kind: "textarea" },
  { path: "/dashboard/products", name: "products", kind: "h1" },
  { path: "/dashboard/customers", name: "customers", kind: "h1" },
  { path: "/dashboard/orders", name: "orders", kind: "h1" },
  { path: "/dashboard/inventory", name: "inventory", kind: "h1" },
  { path: "/dashboard/sales", name: "sales", kind: "h1" },
  { path: "/dashboard/expenses", name: "expenses", kind: "h1" },
  { path: "/dashboard/settings", name: "settings", kind: "h1" },
];

const DESKTOP_VIEW = { width: 1440, height: 900 };
const MOBILE_VIEW = { width: 390, height: 844 };

const results = {
  pass: PASS,
  baseUrl: BASE_URL,
  startedAt: new Date().toISOString(),
  email: EMAIL,
  desktop: { cold: {}, warm: {}, modals: {}, ai: null },
  mobile: { cold: {}, warm: {}, modals: {}, ai: null },
  issues: [],
};

function log(...args) {
  console.log(`[perf/${PASS}]`, ...args);
}

function ms(v) {
  return `${v != null ? v.toFixed(0) : "-"}ms`;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });

  // ---- shared authenticated context (seeded by a real UI sign-in) ----
  let storageState;
  {
    const ctx = await browser.newContext({
      viewport: DESKTOP_VIEW,
      locale: "en-US",
    });
    const page = await ctx.newPage();
    collectErrors(page, results);
    await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 60000 });
    await page.locator("#login-email").fill(EMAIL);
    await page.locator("#login-password").fill(PASSWORD);
    await page.locator("#login-password").press("Enter");
    await page
      .waitForURL((u) => u.pathname === "/dashboard", { timeout: 30000 })
      .catch(() => {});
    const ok = await waitForTarget(page, "h1", 30000).catch(() => null);
    if (!ok) {
      log("LOGIN failed — could not reach dashboard.");
      process.exit(1);
    }
    const h1 = await page.evaluate(
      () => document.querySelector("#main h1")?.textContent?.trim() ?? "",
    );
    log(`signed in; dashboard h1=${JSON.stringify(h1)}`);
    storageState = await ctx.storageState();
    await ctx.close();
  }

  if (RUN_COLD) {
    log("cold-load pass (fresh context per route — empty cache)…");
    results.desktop.cold = await coldPass(browser, "desktop", storageState);
    results.mobile.cold = await coldPass(browser, "mobile", storageState);
  }

  if (RUN_WARM) {
    log("warm sidebar-link pass…");
    results.desktop.warm = await warmPass(browser, "desktop", storageState);
    results.mobile.warm = await warmPass(browser, "mobile", storageState);
  }

  if (RUN_MODALS) {
    log("dialog-open pass…");
    results.desktop.modals = await modalsPass(browser, "desktop", storageState);
    results.mobile.modals = await modalsPass(browser, "mobile", storageState);
  }

  if (RUN_AI) {
    log("AI assistant latency pass…");
    results.desktop.ai = await aiPass(browser, "desktop", storageState);
    results.mobile.ai = await aiPass(browser, "mobile", storageState);
  }

  results.completedAt = new Date().toISOString();

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  printReport(results);
  await browser.close();
  log(`results written to ${RESULTS_FILE}`);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function collectErrors(page, results) {
  page.on("pageerror", (err) => {
    results.issues.push(`pageerror: ${String(err).slice(0, 200)}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      results.issues.push(`console.error: ${msg.text().slice(0, 200)}`);
    }
  });
  page.on("requestfailed", (req) => {
    if (!req.url().includes(BASE_URL) && !req.url().includes("supabase.co"))
      return;
    results.issues.push(`requestfailed: ${req.url().slice(0, 120)} ${req.failure()?.errorText ?? ""}`);
  });
}

async function waitForTarget(page, kind, timeout) {
  await page.waitForFunction(
    (k) => {
      if (k === "textarea") {
        const el = document.getElementById("ai-chat-input");
        return !!el && el.offsetParent !== null;
      }
      const h1 = document.querySelector("#main h1");
      return (
        !!h1 &&
        h1.offsetParent !== null &&
        (h1.textContent || "").trim().length > 0
      );
    },
    kind,
    { polling: "raf", timeout: timeout ?? 90000 },
  );
  return true;
}

/**
 * Sample from Node until the target route content is present, non-empty,
 * different from the previous value, and stable for two consecutive samples.
 * Returns the wall-clock timestamp (Date.now()) when stable visible content
 * was reached, or null on timeout/local-poll error. Node-side polling avoids
 * the transient Suspense/streaming artifacts that a raf `waitForFunction` can
 * catch in the middle of a client-side transition.
 */
async function waitStableVisible(page, kind, route, prevH1, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    let r;
    try {
      r = await page.evaluate(
        (arg) => {
          const sample = () => {
            if (arg.kind === "textarea") {
              const el = document.getElementById("ai-chat-input");
              const ok = !!el && el.offsetParent !== null;
              return { ok, text: ok ? "__visible__" : "" };
            }
            const h1 = document.querySelector("#main h1");
            if (!h1 || h1.offsetParent === null) return { ok: false, text: "" };
            const text = (h1.textContent || "").trim();
            if (text === arg.prevH1 || text.length === 0) {
              return { ok: false, text };
            }
            return { ok: true, text };
          };
          const a = sample();
          if (!a.ok) return { stable: false, text: a.text };
          const b = sample();
          return {
            stable: a.text.length > 0 && b.ok && b.text === a.text,
            text: a.text,
          };
        },
        { kind, route, prevH1 },
      );
    } catch {
      r = { stable: false, text: "" };
    }
    if (!r || typeof r !== "object") r = { stable: false, text: "" };
    if (r.stable) {
      return Date.now();
    }
    await page.waitForTimeout(50);
  }
  return null;
}

async function ensureOnDashboard(page, kind) {
  let pathname = "";
  try {
    pathname = new URL(page.url()).pathname;
  } catch {
    pathname = "";
  }
  if (pathname === "/dashboard") {
    await waitForTarget(page, "h1", 30000);
    return;
  }
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load", timeout: 90000 });
  await waitForTarget(page, "h1", 60000);
}

// ---------------------------------------------------------------------------
// COLD LOAD — fresh context (empty cache) for every route
// ---------------------------------------------------------------------------

function ctxOpts(cfg, storageState) {
  return {
    viewport: cfg.viewport,
    locale: "en-US",
    storageState,
    isMobile: cfg.isMobile ?? false,
    hasTouch: cfg.hasTouch ?? false,
  };
}

async function coldPass(browser, label, storageState) {
  const cfg = { viewport: label === "mobile" ? MOBILE_VIEW : DESKTOP_VIEW };
  if (label === "mobile") {
    cfg.isMobile = true;
    cfg.hasTouch = true;
  }
  const out = {};
  for (const route of ROUTES) {
    const ctx = await browser.newContext(ctxOpts(cfg, storageState));
    const page = await ctx.newPage();
    collectErrors(page, results);
    await page.addInitScript(() => {
      try {
        window.__lcp = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__lcp.push(e.startTime);
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch {
        /* noop */
      }
    });
    const t0 = Date.now();
    await page
      .goto(`${BASE_URL}${route.path}`, { waitUntil: "load", timeout: 90000 })
      .catch((err) => results.issues.push(`cold goto ${route.path}: ${err}`));
    const loadAt = Date.now();
    await waitForTarget(page, route.kind, 60000).catch((err) =>
      results.issues.push(`cold target ${route.path}: ${err}`),
    );
    const visibleAt = Date.now();
    await page
      .waitForLoadState("networkidle", { timeout: 15000 })
      .catch(() => {});
    const netIdleAt = Date.now();
    const nav = await page.evaluate(() => {
      const entries = performance.getEntriesByType("navigation");
      const n = entries[0];
      return n
        ? {
            lcp: window.__lcp && window.__lcp.length
              ? Math.max(...window.__lcp)
              : null,
            domContentLoadedEventEnd: n.domContentLoadedEventEnd,
            loadEventEnd: n.loadEventEnd,
            responseEnd: n.responseEnd,
          }
        : {};
    });
    out[route.name] = {
      path: route.path,
      visibleMs: ms(visibleAt - t0),
      loadEventMs: nav.loadEventEnd != null ? ms(nav.loadEventEnd) : ms(loadAt - t0),
      dclMs: nav.domContentLoadedEventEnd != null ? ms(nav.domContentLoadedEventEnd) : null,
      lcpMs: nav.lcp != null ? ms(nav.lcp) : null,
      networkIdleMs: ms(netIdleAt - t0),
    };
    log(`  cold ${label}/${route.name}: visible=${ms(visibleAt - t0)} lcp=${nav.lcp != null ? ms(nav.lcp) : "n/a"}`);
    await ctx.close();
  }
  return out;
}

// ---------------------------------------------------------------------------
// WARM NAV — real sidebar link clicks inside the SPA
// ---------------------------------------------------------------------------

async function warmPass(browser, label, storageState) {
  const cfg = { viewport: label === "mobile" ? MOBILE_VIEW : DESKTOP_VIEW };
  if (label === "mobile") {
    cfg.isMobile = true;
    cfg.hasTouch = true;
  }
  const ctx = await browser.newContext(ctxOpts(cfg, storageState));
  const page = await ctx.newPage();
  collectErrors(page, results);
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load", timeout: 90000 });
  await waitForTarget(page, "h1", 60000);
  const dashboardH1 = await page.evaluate(
    () => document.querySelector("#main h1")?.textContent?.trim() ?? "",
  );

  const out = {};
  for (const route of ROUTES) {
    if (route.name === "dashboard") {
      // Measure "click Dashboard" from another module so the target h1
      // actually changes (same-route clicks are a no-op).
      await page.goto(`${BASE_URL}/dashboard/products`, {
        waitUntil: "load",
        timeout: 90000,
      });
      await waitForTarget(page, "h1", 60000);
    } else {
      await ensureOnDashboard(page, "h1");
    }
    const prevH1 = await page.evaluate(
      () => document.querySelector("#main h1")?.textContent?.trim() ?? "",
    );

    let link;
    if (label === "mobile") {
      await page.locator('button[aria-controls="mobile-nav-drawer"]').click();
      await page
        .locator(`#mobile-nav-drawer a[href="${route.path}"]`)
        .first()
        .waitFor({ state: "visible", timeout: 10000 });
      link = page.locator(`#mobile-nav-drawer a[href="${route.path}"]`).first();
    } else {
      link = page.locator(`aside a[href="${route.path}"]`).first();
    }
    await link.scrollIntoViewIfNeeded().catch(() => {});

    // Measure REAL click-to-visible-content. The previous one-shot
    // `waitForFunction(polling: "raf")` resolved on a TRANSIENT Suspense/
    // streaming state (h1 briefly exists mid-transition then is cleared),
    // so it under-reported (or timed out on the stale marks). Instead we
    // sample from Node until the target content is present, non-empty,
    // different from the previous value, AND stable for two consecutive
    // samples. That gives a trustworthy click-to-visible-content number.
    const t0 = Date.now();
    await link.click();
    const t1 = await waitStableVisible(page, route.kind, route.path, prevH1, 25000);
    const wallMs = t1 != null ? t1 - t0 : null;

    out[route.name] = {
      path: route.path,
      clickToVisibleMs: wallMs != null ? ms(wallMs) : "TIMEOUT",
    };
    log(`  warm ${label}/${route.name}: click→visible=${wallMs != null ? ms(wallMs) : "TIMEOUT"}`);
    if (!t1) {
      results.issues.push(
        `warm ${label}/${route.name}: content did not appear & stabilise within 25s`,
      );
      // Diagnostic dump so a real regression is identifiable, not a bare timeout.
      try {
        const dump = await page.evaluate(() => ({
          url: location.href,
          h1s: [...document.querySelectorAll("#main h1")].map((h) => h.textContent.trim()),
          aiInput: !!document.getElementById("ai-chat-input"),
          drawerVisible: !!document.getElementById("mobile-nav-drawer"),
          asideLinks: [...document.querySelectorAll("aside a")].length,
          drawerLinks: [...document.querySelectorAll("#mobile-nav-drawer a")].length,
        }));
        results.issues.push(
          `warm ${label}/${route.name} state: ${JSON.stringify(dump)}`,
        );
      } catch {
        /* page may be gone */
      }
    }
  }
  await ctx.close();
  return out;
}

// ---------------------------------------------------------------------------
// MODAL OPEN — every module with a header action button
// ---------------------------------------------------------------------------

const MODAL_ROUTES = [
  { name: "products", path: "/dashboard/products" },
  { name: "customers", path: "/dashboard/customers" },
  { name: "orders", path: "/dashboard/orders" },
  { name: "expenses", path: "/dashboard/expenses" },
];

async function modalsPass(browser, label, storageState) {
  const cfg = { viewport: label === "mobile" ? MOBILE_VIEW : DESKTOP_VIEW };
  if (label === "mobile") {
    cfg.isMobile = true;
    cfg.hasTouch = true;
  }
  const ctx = await browser.newContext(ctxOpts(cfg, storageState));
  const page = await ctx.newPage();
  collectErrors(page, results);
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load", timeout: 90000 });
  await waitForTarget(page, "h1", 60000);

  const out = {};
  for (const mod of MODAL_ROUTES) {
    await ensureOnDashboard(page, "h1");

    // Navigate using the target-route link exactly like the warm pass, and
    // actually wait for the destination route + content (the previous version
    // passed prevH1:"" which resolved instantly while still on /dashboard).
    let link;
    if (label === "mobile") {
      await page
        .locator('button[aria-controls="mobile-nav-drawer"]')
        .click();
      await page
        .locator(`#mobile-nav-drawer a[href="${mod.path}"]`)
        .first()
        .waitFor({ state: "visible", timeout: 10000 });
      link = page.locator(`#mobile-nav-drawer a[href="${mod.path}"]`).first();
    } else {
      link = page.locator(`aside a[href="${mod.path}"]`).first();
    }
    await link.scrollIntoViewIfNeeded().catch(() => {});
    await link.click();
    await page
      .waitForFunction(
        (p) => location.pathname === p,
        mod.path,
        { polling: "raf", timeout: 25000 },
      )
      .catch((err) =>
        results.issues.push(`modal ${label}/${mod.name}: nav failed: ${String(err).slice(0, 120)}`),
      );
    await waitForTarget(page, "h1", 30000).catch((err) =>
      results.issues.push(`modal ${label}/${mod.name}: content wait: ${String(err).slice(0, 120)}`),
    );

    const actionBtn = page.locator("#main header button").first();
    const count = await actionBtn.count();
    if (count === 0) {
      out[mod.name] = { skipped: true, reason: "no header action button" };
      log(`  modal ${label}/${mod.name}: SKIPPED (no header button)`);
      continue;
    }
    const t0 = Date.now();
    await actionBtn.click();
    const opened = await page
      .waitForSelector('[role="dialog"]', { state: "visible", timeout: 10000 })
      .catch(() => null);
    const openedAt = Date.now();
    if (opened) {
      out[mod.name] = { openMs: ms(openedAt - t0) };
      log(`  modal ${label}/${mod.name}: open=${ms(openedAt - t0)}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(350);
    } else {
      out[mod.name] = { failed: true };
      results.issues.push(`modal ${label}/${mod.name}: dialog did not open`);
    }
  }
  await ctx.close();
  return out;
}

// ---------------------------------------------------------------------------
// AI ASSISTANT LATENCY
// ---------------------------------------------------------------------------

async function aiPass(browser, label, storageState) {
  const cfg = { viewport: label === "mobile" ? MOBILE_VIEW : DESKTOP_VIEW };
  if (label === "mobile") {
    cfg.isMobile = true;
    cfg.hasTouch = true;
  }
  const ctx = await browser.newContext(ctxOpts(cfg, storageState));
  const page = await ctx.newPage();
  collectErrors(page, results);
  await page.goto(`${BASE_URL}/dashboard/assistant`, {
    waitUntil: "load",
    timeout: 90000,
  });
  await waitForTarget(page, "textarea", 60000);
  await page.waitForTimeout(1200); // let history/conversations settle

  // Install in-page observer BEFORE submitting so first-token + settle are
  // measured from the fast-path user experience.
  await page.evaluate(() => {
    const perf = (window.__aiPerf = {
      firstTextAt: null,
      settleAt: null,
      error: null,
      baseCount: -1,
    });
    const isAssistantLi = (li) => !!li.querySelector(":scope > svg");
    const submitText = () => window.__aiSubmitText || "";
    const findUl = () =>
      [...document.querySelectorAll("main ul")].find((u) =>
        [...u.children].some((li) => isAssistantLi(li)),
      );
    let settleTimer = null;
    const scheduleSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        scan();
      }, 800);
    };
    const scan = () => {
      if (perf.settleAt || perf.error) return;
      const ul = findUl();
      if (!ul) return;
      const lis = [...ul.children];
      if (perf.baseCount < 0 || lis.length <= perf.baseCount) return;
      const fresh = lis.slice(perf.baseCount);
      let aiLi = null;
      for (let i = fresh.length - 1; i >= 0; i--) {
        if (isAssistantLi(fresh[i])) {
          aiLi = fresh[i];
          break;
        }
      }
      if (!aiLi) return;
      const contentEl = aiLi.querySelector('div[class*="whitespace-pre-wrap"]');
      const len = contentEl ? (contentEl.textContent || "").length : 0;
      if (perf.firstTextAt == null && len > 0) {
        perf.firstTextAt = performance.now();
      }
      if (len > 0) {
        if (len !== perf._lastLen) {
          perf._lastLen = len;
          perf._lastChangeAt = performance.now();
          scheduleSettle();
        } else if (
          perf._lastLen > 0 &&
          performance.now() - perf._lastChangeAt > 700 &&
          perf.settleAt == null
        ) {
          perf.settleAt = performance.now();
        }
      }
      const errEl = aiLi.querySelector(
        'div[class*="border-red"], div[class*="border-red-500"]',
      );
      if (errEl) perf.error = errEl.textContent || "ai error";
    };
    window.__aiScan = scan;
    new MutationObserver(scan).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });

  const message = "Apne products list karo"; // safe read-only request
  await page.evaluate(() => {
    window.__aiSubmitText = "Apne products list karo";
  });
  const textarea = page.locator("#ai-chat-input");
  await textarea.fill(message);
  await page.evaluate(() => {
    const ul = [...document.querySelectorAll("main ul")].find((u) =>
      [...u.children].some((li) => li.querySelector(":scope > svg")),
    );
    window.__aiPerf.baseCount = ul ? ul.children.length : 0;
  });
  const p0 = await page.evaluate(() => performance.now());
  const t0 = Date.now();
  await textarea.press("Enter");
  const settled = await page
    .waitForFunction(
      () =>
        window.__aiPerf &&
        (window.__aiPerf.settleAt != null || window.__aiPerf.error != null),
      { polling: 250, timeout: 120000 },
    )
    .catch(() => null);
  const t1 = Date.now();
  const ai = await page.evaluate(() => {
    const perf = window.__aiPerf || {};
    return {
      firstTokenAt: perf.firstTextAt,
      settleAt: perf.settleAt,
      error: perf.error || null,
    };
  });

  const out = {
    message,
    submitToFirstMs:
      ai.firstTokenAt != null ? ms(ai.firstTokenAt - p0) : null,
    submitToSettleMs: ai.settleAt != null ? ms(ai.settleAt - p0) : null,
    submitToSettleWallMs: settled ? ms(t1 - t0) : "TIMEOUT",
    firstTokenObserved: ai.firstTokenAt != null,
    error: ai.error,
  };
  log(
    `  ai ${label}: submit→settle=${out.submitToSettleWallMs}${out.error ? ` error=${ai.error}` : ""}`,
  );
  if (!settled || ai.error) {
    results.issues.push(
      `ai ${label}: ${ai.error || "no settle within 120s"}`,
    );
  }
  await ctx.close();
  return out;
}

// ---------------------------------------------------------------------------
// REPORT
// ---------------------------------------------------------------------------

function printReport(r) {
  const fmt = (v) => v ?? "n/a";
  const line = (a, b, c) => `${a.padEnd(14)} ${b.padEnd(18)} ${c}`;
  for (const label of ["desktop", "mobile"]) {
    console.log(`\n===== ${label.toUpperCase()} =====`);
    console.log("-- cold load (fresh context, empty cache) --");
    console.log(line("route", "visible", "LCP"));
    for (const route of ROUTES) {
      const c = r[label].cold[route.name] || {};
      console.log(
        line(route.name, fmt(c.visibleMs), fmt(c.lcpMs)),
      );
    }
    console.log("-- warm sidebar click → stable visible --");
    console.log(line("route", "click→visible", ""));
    for (const route of ROUTES) {
      const w = r[label].warm[route.name] || {};
      console.log(
        line(route.name, fmt(w.clickToVisibleMs), ""),
      );
    }
    if (r[label].modals && Object.keys(r[label].modals).length) {
      console.log("-- dialog open --");
      for (const [name, m] of Object.entries(r[label].modals)) {
        console.log(`  ${name.padEnd(12)} ${m.skipped ? m.reason : fmt(m.openMs)}`);
      }
    }
    if (r[label].ai) {
      console.log(
        `-- AI assistant -- submit→first-token: ${r[label].ai.submitToFirstMs ?? "n/a"}  submit→settle: ${r[label].ai.submitToSettleMs ?? r[label].ai.submitToSettleWallMs}${r[label].ai.error ? ` (error: ${r[label].ai.error})` : ""}`,
      );
    }
  }
  console.log(`\n===== issues (${r.issues.length}) =====`);
  for (const issue of r.issues.slice(0, 40)) console.log("  -", issue);
}

main().catch((err) => {
  console.error("[perf] fatal:", err);
  process.exit(1);
});