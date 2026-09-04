/**
 * Pure ad-budget planner — Phase 0 (Connect Meta Ads, reduced scope).
 *
 * Turns a monthly budget cap into a suggested DAILY budget. This is a pure
 * function: no API calls, no side effects, no I/O, so it can be unit-tested
 * offline with zero Meta connection (docs/phase0.txt §3).
 *
 * Two ideas drive the calculation:
 *
 * 1. Spread the cap over the days actually left in the current month. Rather
 *    than dividing by 30 (a fixed month length), we count how many days remain
 *    from today (inclusive) to the end of the month, so a mid/late-month run
 *    spends the right amount per day and does not run out before the month ends.
 *
 * 2. A safety margin below 100% of the cap. Meta's ad auction can spike a
 *    daily spend above a plain daily quota before it throttles, so pacing at
 *    exactly cap/days risks occasionally overshooting the monthly cap. Target
 *    ~95% instead, leaving headroom for auction overshoot while still spending
 *    almost the full budget.
 *
 * The margin is a NAMED constant (not a magic number) and chosen conservatively:
 * 95% spends the overwhelming majority of the budget while leaving a 5% buffer
 * against Meta auction overshoot and minor rounding drift. Lowering it spends
 * less; raising it toward 1.0 removes overshoot protection.
 */

export const SAFE_UTILIZATION_RATIO = 0.95;

/** Outcomes when the monthly cap is missing, zero or invalid. */
export const INVALID_CAP = null;

export interface DailyBudgetPlan {
  /** The supplied monthly cap (validated, > 0). */
  monthlyBudgetCap: number;
  /** cap x SAFE_UTILIZATION_RATIO — the actual spend target for the month. */
  safetyTarget: number;
  /** Number of days left in the current month, today (inclusive). >= 1. */
  daysRemaining: number;
  /**
   * The suggested per-day budget, rounded to 2 decimals:
   * safetyTarget / daysRemaining.
   */
  suggestedDailyBudget: number;
}

/**
 * Number of calendar days left in the month containing `date`, counting today
 * itself (inclusive). Always >= 1. This is a small exported helper so the unit
 * test can pin exact values for start/mid/end-of-month scenarios.
 */
export function daysRemainingInMonth(date: Date): number {
  const lastDayOfMonth = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
  ).getDate();
  // +1 so today counts: e.g. the 15th of a 30-day month leaves 16 days
  // (15th..30th inclusive).
  return lastDayOfMonth - date.getDate() + 1;
}

function isInvalidCap(cap: number | null | undefined): boolean {
  if (cap === null || cap === undefined) return true;
  return !Number.isFinite(cap) || cap <= 0;
}

/**
 * Suggests a daily budget for the current month from a monthly cap.
 *
 * Returns `null` (INVALID_CAP) when the cap is missing, zero or non-finite —
 * the caller should then present "no cap / cannot plan" honestly rather than a
 * fabricated number. `now` is injectable for deterministic unit tests.
 */
export function suggestDailyBudget(
  monthlyBudgetCap: number | null | undefined,
  now: Date = new Date(),
): DailyBudgetPlan | null {
  if (isInvalidCap(monthlyBudgetCap)) return INVALID_CAP;
  const cap = monthlyBudgetCap as number;

  const daysRemaining = daysRemainingInMonth(now);
  const safetyTarget = cap * SAFE_UTILIZATION_RATIO;
  const suggestedDailyBudget =
    Math.round((safetyTarget / daysRemaining) * 100) / 100;

  return {
    monthlyBudgetCap: cap,
    safetyTarget,
    daysRemaining,
    suggestedDailyBudget,
  };
}
