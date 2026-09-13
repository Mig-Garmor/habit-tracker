import {
  isWeekComplete, lastNWeekStarts, nextWeek, previousWeek, startOfWeek, weekDays,
} from './date.js'

/**
 * How consistent a habit is, and whether to suggest parking it. Change these
 * four numbers and the whole warning system moves with them.
 */
export const WINDOW_WEEKS = 4
export const GRACE_WEEKS = 2
/**
 * A streak forgives one missed occurrence a week (D-25a). Without this, a
 * daily habit kept 6 days out of 7 has a streak of zero forever — the same
 * flaw cadence was introduced to fix, just moved onto daily habits.
 */
export const STREAK_TOLERANCE = 1
export const STRUGGLING_BELOW = 0.5
export const CONSISTENT_AT_OR_ABOVE = 0.8

export type Health = 'new' | 'struggling' | 'steady' | 'consistent'

export interface WeekSummary {
  start: string
  completed: number
  expected: number
  met: boolean
}

/**
 * One entry per week in the window, oldest first, always including the week
 * that contains `today`. `completed` is the real count, uncapped, so the UI can
 * show a genuinely heavy week; `met` is what scoring uses (D-22).
 */
export function weekSummaries(
  completedDates: Iterable<string>,
  today: string,
  activatedAt: string | null,
  timesPerWeek: number,
): WeekSummary[] {
  if (!activatedAt) return []
  const completed = new Set(completedDates)
  const expected = Math.max(1, timesPerWeek)

  return lastNWeekStarts(WINDOW_WEEKS, today).map(start => {
    const done = weekDays(start).filter(day => completed.has(day)).length
    return { start, completed: done, expected, met: done >= expected }
  })
}

/**
 * Whether a week may be scored (D-21). A week counts when it is complete and
 * began on or after activation. A week that fails either test counts anyway if
 * it already met cadence — so the week in progress and the week a habit was
 * created can lift the score but never lower it.
 */
function weekCounts(summary: WeekSummary, today: string, activatedAt: string): boolean {
  // Strictly after: the activation week itself is a partial week, so it gets
  // the same met-only treatment as the week in progress, not an unconditional
  // pass just because the calendar week has since elapsed.
  const settled = isWeekComplete(summary.start, today) && summary.start > startOfWeek(activatedAt)
  return settled || summary.met
}

/** Mean of capped week scores over the countable weeks (D-22, D-24). */
export function completionRate(
  completedDates: Iterable<string>,
  today: string,
  activatedAt: string | null,
  timesPerWeek: number,
): number {
  if (!activatedAt) return 0

  const counted = weekSummaries(completedDates, today, activatedAt, timesPerWeek)
    .filter(summary => weekCounts(summary, today, activatedAt))
  if (counted.length === 0) return 0

  const total = counted.reduce(
    (sum, summary) => sum + Math.min(1, summary.completed / summary.expected),
    0,
  )
  return total / counted.length
}

/**
 * Consecutive weeks that met cadence, most recent first (D-25). The week in
 * progress does not break a streak merely by being unfinished — the same
 * tolerance D-4 gives an unlogged today.
 */
/**
 * How many completions a week needs to keep a streak alive: one short of
 * cadence, but never zero. The floor matters — with a cadence of 1, "one
 * short" would be none, and a weekly habit never done at all would keep its
 * streak indefinitely. Showing up at least once is always required.
 */
function streakBar(timesPerWeek: number): number {
  return Math.max(1, Math.max(1, timesPerWeek) - STREAK_TOLERANCE)
}

export function currentStreak(
  completedDates: Iterable<string>,
  today: string,
  activatedAt: string | null,
  timesPerWeek: number,
): number {
  if (!activatedAt) return 0

  const completed = new Set(completedDates)
  // The tolerant bar, not `expected`. Scoring stays strict: completionRate and
  // the grid's `met` still require the full cadence. Only the streak forgives.
  const bar = streakBar(timesPerWeek)
  let cursor = startOfWeek(today)
  let streak = 0

  // A current week that has not yet cleared the bar is skipped, not counted as
  // a break — the same tolerance D-4 gives an unlogged today.
  const thisWeekDone = weekDays(cursor).filter(day => completed.has(day)).length
  if (thisWeekDone < bar) {
    cursor = previousWeek(cursor)
  }

  while (true) {
    const done = weekDays(cursor).filter(day => completed.has(day)).length
    if (done < bar) break
    streak += 1
    cursor = previousWeek(cursor)
  }

  return streak
}

/** Whole weeks between the activation week and the current one — 0 during it. */
function weeksSinceActivation(activatedAt: string, today: string): number {
  let cursor = startOfWeek(activatedAt)
  const target = startOfWeek(today)
  let weeks = 0
  while (cursor < target) {
    cursor = nextWeek(cursor)
    weeks += 1
  }
  return weeks
}

export function classifyHealth(
  completedDates: Iterable<string>,
  today: string,
  activatedAt: string | null,
  timesPerWeek: number,
): Health {
  if (!activatedAt) return 'new'
  if (weeksSinceActivation(activatedAt, today) < GRACE_WEEKS) return 'new'

  const rate = completionRate(completedDates, today, activatedAt, timesPerWeek)
  if (rate < STRUGGLING_BELOW) return 'struggling'
  if (rate >= CONSISTENT_AT_OR_ABOVE) return 'consistent'
  return 'steady'
}
