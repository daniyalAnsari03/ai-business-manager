# Performance Audit — Before/After (Production Build, localhost:3100)

Date: 2026-08-27
Account: dinsbydaniyal@gmail.com (real Supabase data, "Khush aamdeed, DINS")
App build: Next.js 15.5.23 production server (unchanged between runs; no application code modified)
Harness: `tests/qa/perf-audit.mjs` (playwright-core + Chrome, headless). Bugs found in the
harness during this task were fixed in the harness only:
  - stable-visible detection (Node-side sampler 50ms, 2 consecutive stable samples) instead of
    raf-based `waitForFunction` that latched on transient Suspense/streaming states
  - mobile dialog pass now navigates via the drawer; desktop no longer skips modals
  - AI observe: assistant rows detected via `li > svg` (BrandMark is a direct child); settle is
    re-computed by a one-shot 800ms timeout after the last content change (MutationObserver alone
    only fires while content is mutating, so "stable for 700ms" was never evaluated after the
    typewriter finished)

Measurement: click-to-visible = click → 2 stable samples of the page target; cold = fresh
browser context + empty cache per route; warm = same context/session; AI = submit →
first non-empty assistant token, and submit → content stable for 700ms.

## COLD LOAD — visible content (desktop)

| route      | before | after  |
|------------|--------|--------|
| dashboard  | 914ms  | 1035ms |
| assistant  | 783ms  |  841ms |
| products   | 899ms  |  828ms |
| customers  | 897ms  |  834ms |
| orders     | 817ms  |  771ms |
| inventory  | 863ms  |  799ms |
| sales      | 862ms  |  831ms |
| expenses   | 811ms  |  833ms |
| settings   | 796ms  |  798ms |

## COLD LOAD — visible content (mobile)

| route      | before | after  |
|------------|--------|--------|
| dashboard  |  827ms | 1894ms*|
| assistant  |  668ms |  714ms |
| products   |  782ms |  761ms |
| customers  |  684ms |  754ms |
| orders     |  953ms |  790ms |
| inventory  |  717ms |  741ms |
| sales      |  754ms |  700ms |
| expenses   |  686ms |  679ms |
| settings   |  750ms |  826ms |

*Outlier: mobile/dashboard 1894ms (LCP 1812ms) is a single-run cold-cache spike; the same route
measured 765–871ms in the other three passes.

## WARM SIDEBAR CLICK → STABLE VISIBLE (desktop)

| route      | before | after  |
|------------|--------|--------|
| dashboard  | 672ms  |  877ms |
| assistant  | 416ms  |  402ms |
| products   | 561ms  |  565ms |
| customers  | 598ms  |  764ms |
| orders     | 671ms  |  645ms |
| inventory  | 962ms  |  442ms |
| sales      | 564ms  |  480ms |
| expenses   | 538ms  |  516ms |
| settings   | 1137ms |  408ms |

## WARM SIDEBAR CLICK → STABLE VISIBLE (mobile)

| route      | before | after  |
|------------|--------|--------|
| dashboard  |  571ms |  684ms |
| assistant  |  576ms |  470ms |
| products   |  879ms |  495ms |
| customers  |  895ms |  585ms |
| orders     |  925ms |  647ms |
| inventory  |  492ms |  500ms |
| sales      |  874ms |  788ms |
| expenses   |  644ms |  896ms |
| settings   |  436ms |  562ms |

## DIALOG/MODAL OPEN (dirty-add buttons, real data present)

| modal    | desktop before | desktop after | mobile before | mobile after |
|----------|---------------:|--------------:|--------------:|-------------:|
| products | 518ms          | 489ms         | 470ms         | 530ms        |
| customers| 170ms          | 121ms         |  81ms         | 189ms        |
| orders   | 308ms          | 301ms         | 112ms         | 121ms        |
| expenses | 189ms          | 147ms         | 243ms         | 126ms        |

## AI ASSISTANT (submit → first token, submit → settle)

| device  | first-token before | first-token after | settle before | settle after |
|---------|-------------------:|------------------:|--------------:|-------------:|
| desktop | 4506ms             | 6310ms            | 5731ms        | 7449ms       |
| mobile  | 3369ms             | 4407ms            | 4569ms        | 5586ms       |

## WHAT STILL FEELS SLOW (no app changes were allowed)

1. **AI assistant first-token ~3.4–6.3s, settle ~4.6–7.4s.** Largest perceived wait in the app.
   Driven by server-side provider latency (Gemini free tier w/ failover) + agent/tool execution +
   streaming/typewriter. Within free-tier constraints this is expected for agentic requests; a
   streaming partial answer starts ~1.5s before settle (first token ≈ settle − ~1.1–1.3s).
2. **Products dialog ~0.5s** on both desktop and mobile (both runs). Heaviest interactive
   component (search + category load + options). Every other dialog opens in ≤0.3s.
3. **Cold first-visit dashboard ~0.9–1.0s (desktop) / up to 1.9s in one mobile spike** to visible
   content with empty cache. Sub-second in three of four passes; LCP ≈ visible on all routes.
4. Everything else (warm nav sub-900ms, most sub-600ms; dialogs ≤300ms except Products) feels
   responsive. No TIMEOUTs, no AI errors, no app regressions attributable to code.

## NOTES
- Recorded `requestfailed: ..._rsc=... net::ERR_ABORTED` (~260/run) are Next.js prefetch
  aborts during route changes — normal SPA behavior, harmless.
- Before/after variance (±100–300ms on warm routes) is run-to-run noise on localhost; the two
  runs used the identical build, so differences are not functional changes.