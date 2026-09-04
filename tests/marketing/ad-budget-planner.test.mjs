/**
 * Offline unit tests for the pure ad-budget planner (docs/phase0.txt §3).
 *
 * The function is deliberately side-effect-free (no API, no I/O), so these
 * tests run with NO Meta connection and NO business data — just Node + the
 * project's TS loader hooks.
 *
 * Run: node --conditions=react-server --import ./tests/ai/register-hooks.mjs tests/marketing/ad-budget-planner.test.mjs
 */

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const {
  SAFE_UTILIZATION_RATIO,
  INVALID_CAP,
  daysRemainingInMonth,
  suggestDailyBudget,
} = await import("../../lib/marketing/ad-budget-planner.ts");

/* ---------------------------------------------------------------------------
 * Days-remaining helper — pin exact values across the month.
 * ------------------------------------------------------------------------ */

// 2026-09-01 (a 30-day September): 30..1 inclusive = 30 days.
record(
  "daysRemaining: first of month counts all days",
  daysRemainingInMonth(new Date(2026, 8, 1)) === 30,
  `got=${daysRemainingInMonth(new Date(2026, 8, 1))}`,
);

// 2026-09-15: 30 - 15 + 1 = 16 days (15th..30th inclusive).
record(
  "daysRemaining: mid-month counts remaining days inclusive of today",
  daysRemainingInMonth(new Date(2026, 8, 15)) === 16,
  `got=${daysRemainingInMonth(new Date(2026, 8, 15))}`,
);

// 2026-09-30: 30 - 30 + 1 = 1 day.
record(
  "daysRemaining: last day of month counts exactly one day",
  daysRemainingInMonth(new Date(2026, 8, 30)) === 1,
  `got=${daysRemainingInMonth(new Date(2026, 8, 30))}`,
);

// 2026-10-05 (a 31-day October): 31 - 5 + 1 = 27 days.
record(
  "daysRemaining: 31-day month is correct",
  daysRemainingInMonth(new Date(2026, 9, 5)) === 27,
  `got=${daysRemainingInMonth(new Date(2026, 9, 5))}`,
);

/* ---------------------------------------------------------------------------
 * suggestDailyBudget — start of month, mid-month, end of month, invalid/zero.
 * ------------------------------------------------------------------------ */

// Rs 5000 cap, day 1 of a 30-day month.
{
  const plan = suggestDailyBudget(5000, new Date(2026, 8, 1));
  record(
    "Planner: Rs 5000 cap, start of month (30 days) -> suggested daily budget",
    plan !== null &&
      plan.daysRemaining === 30 &&
      plan.safetyTarget === 4750 &&
      plan.suggestedDailyBudget === 158.33,
    `cap=5000 days=30 target=4750 daily=${plan?.suggestedDailyBudget}`,
  );
}

// Rs 5000 cap, 15 days left in the month.
{
  const plan = suggestDailyBudget(5000, new Date(2026, 8, 15));
  const daily = Math.round((4750 / 16) * 100) / 100; // 296.88
  record(
    "Planner: Rs 5000 cap, 15 days left -> suggested daily budget higher per day",
    plan !== null &&
      plan.daysRemaining === 16 &&
      plan.suggestedDailyBudget === daily,
    `cap=5000 days=16 target=4750 daily=${plan?.suggestedDailyBudget}`,
  );
}

// Rs 5000 cap, on the last day of the month.
{
  const plan = suggestDailyBudget(5000, new Date(2026, 8, 30));
  record(
    "Planner: Rs 5000 cap, last day of month -> spends the safety target that day",
    plan !== null &&
      plan.daysRemaining === 1 &&
      plan.suggestedDailyBudget === 4750,
    `cap=5000 days=1 target=4750 daily=${plan?.suggestedDailyBudget}`,
  );
}

// A larger cap, start of a 31-day month.
{
  const plan = suggestDailyBudget(30000, new Date(2026, 0, 1)); // January 1, 31 days
  record(
    "Planner: Rs 30000 cap, January (31 days) -> daily = 28500/31",
    plan !== null &&
      plan.daysRemaining === 31 &&
      plan.suggestedDailyBudget === 919.35,
    `days=${plan?.daysRemaining} daily=${plan?.suggestedDailyBudget}`,
  );
}

// Zero / invalid budget inputs must never produce a fabricated plan.
record(
  "Planner: zero cap returns null (no plan)",
  suggestDailyBudget(0, new Date(2026, 8, 15)) === INVALID_CAP,
);

record(
  "Planner: null cap returns null",
  suggestDailyBudget(null, new Date(2026, 8, 15)) === INVALID_CAP,
);

record(
  "Planner: undefined cap returns null",
  suggestDailyBudget(undefined, new Date(2026, 8, 15)) === INVALID_CAP,
);

record(
  "Planner: negative cap returns null",
  suggestDailyBudget(-100, new Date(2026, 8, 15)) === INVALID_CAP,
);

record(
  "Planner: non-finite cap returns null",
  suggestDailyBudget(Number.NaN, new Date(2026, 8, 15)) === INVALID_CAP &&
    suggestDailyBudget(Number.POSITIVE_INFINITY, new Date(2026, 8, 15)) === INVALID_CAP,
);

/* ---------------------------------------------------------------------------
 * Safety-margin invariant: the suggested daily budget never asks for the FULL
 * cap — always a target of SAFE_UTILIZATION_RATIO x cap (overshoot protection).
 * ------------------------------------------------------------------------ */
record(
  "Planner: daily budget never targets 100% of the cap (safety margin applied)",
  (() => {
    const plan = suggestDailyBudget(10000, new Date(2026, 8, 10));
    if (!plan) return false;
    return plan.safetyTarget === 10000 * SAFE_UTILIZATION_RATIO &&
      plan.safetyTarget < 10000;
  })(),
  `ratio=${SAFE_UTILIZATION_RATIO}`,
);

/* ---------------------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------------------ */
const failed = results.filter((r) => !r.passed);
console.log("\n===== SUMMARY =====");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
