import { dateRange, lastNDays } from './date.js'

/**
 * How consistent a habit is, and whether to suggest parking it. Change these
 * four numbers and the whole warning system moves with them.
 */
export const GRACE_DAYS = 14
export const WINDOW_DAYS = 14
export const STRUGGLING_BELOW = 0.5
export const CONSISTENT_AT_OR_ABOVE = 0.8

export type Health = 'new' | 'struggling' | 'steady' | 'consistent'

/**
 * Completed days over eligible days in the trailing window. Days before the
 * habit was activated are excluded from the denominator, so a habit active for
 * four days is judged out of four rather than out of fourteen.
 */
export function completionRate(
  completedDates: Iterable<string>,
  today: string,
  activatedAt: string | null,
): number {
  if (!activatedAt) return 0

  const eligible = lastNDays(WINDOW_DAYS, today).filter(date => date >= activatedAt)
  if (eligible.length === 0) return 0

  const completed = new Set(completedDates)
  const done = eligible.filter(date => completed.has(date)).length
  return done / eligible.length
}

/** Whole days since activation — 0 on the activation day itself. */
function daysSinceActivation(activatedAt: string, today: string): number {
  return Math.max(0, dateRange(activatedAt, today).length - 1)
}

export function classifyHealth(
  completedDates: Iterable<string>,
  today: string,
  activatedAt: string | null,
): Health {
  if (!activatedAt) return 'new'
  if (daysSinceActivation(activatedAt, today) < GRACE_DAYS) return 'new'

  const rate = completionRate(completedDates, today, activatedAt)
  if (rate < STRUGGLING_BELOW) return 'struggling'
  if (rate >= CONSISTENT_AT_OR_ABOVE) return 'consistent'
  return 'steady'
}
