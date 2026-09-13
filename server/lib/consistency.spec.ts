import { describe, expect, it } from 'vitest'
import {
  classifyHealth, completionRate, currentStreak, summariseWeeks, weekSummaries,
} from './consistency.js'
import { weekDays } from './date.js'

// Monday 2026-08-10, 2026-08-17, 2026-08-24, 2026-08-31, 2026-09-07.
// "Today" is Wed 2026-09-09, whose week (W4) is incomplete. The scoring
// window is WINDOW_WEEKS (4) complete weeks plus the current one (D-24),
// i.e. lastNWeekStarts(WINDOW_WEEKS + 1, TODAY) = [W0, W1, W2, W3, W4].
const TODAY = '2026-09-09'
const ACTIVATED = '2026-06-01'

/** The first `n` days of the week starting `weekStart`, Monday onward. */
function daysIn(weekStart: string, n: number): string[] {
  return weekDays(weekStart).slice(0, n)
}

const W0 = '2026-08-10'
const W1 = '2026-08-17'
const W2 = '2026-08-24'
const W3 = '2026-08-31'
const W4 = '2026-09-07' // the week containing TODAY — incomplete

describe('completionRate with cadence', () => {
  it('scores a 4x/week habit kept exactly as 1.0', () => {
    const done = [...daysIn(W0, 4), ...daysIn(W1, 4), ...daysIn(W2, 4), ...daysIn(W3, 4)]
    expect(completionRate(done, TODAY, ACTIVATED, 4)).toBe(1)
  })

  it('scores a 1x/week habit kept exactly as 1.0', () => {
    const done = [...daysIn(W0, 1), ...daysIn(W1, 1), ...daysIn(W2, 1), ...daysIn(W3, 1)]
    expect(completionRate(done, TODAY, ACTIVATED, 1)).toBe(1)
  })

  it('caps a week at 100% and does not carry the surplus (D-22)', () => {
    // The window is W0-W3 complete, W4 in progress. W0 and W1 are complete,
    // long after activation, and have no logged days, so they count as
    // genuine zeros; W2 is 6/4 capped to 1; W3 is 2/4 = 0.5. Average of
    // [0, 0, 1, 0.5] over 4 weeks is 0.375 — 6 then 2 against a cadence of
    // 4 caps, it does not carry the surplus.
    const done = [...daysIn(W2, 6), ...daysIn(W3, 2)]
    expect(completionRate(done, TODAY, ACTIVATED, 4)).toBeCloseTo(0.375, 5)
  })

  it('ignores an unmet week in progress (D-21)', () => {
    const done = [
      ...daysIn(W0, 4), ...daysIn(W1, 4), ...daysIn(W2, 4), ...daysIn(W3, 4), ...daysIn(W4, 1),
    ]
    // The single day of the current week must not drag 1.0 down.
    expect(completionRate(done, TODAY, ACTIVATED, 4)).toBe(1)
  })

  it('counts a week in progress once it has met cadence (D-21)', () => {
    const done = [...daysIn(W3, 0), ...daysIn(W4, 2)]
    // W4 met a cadence of 2, so it counts; W0-W3 are complete and empty.
    // Average of [0, 0, 0, 0, 1] over 5 weeks is 0.2.
    expect(completionRate(done, TODAY, ACTIVATED, 2)).toBeCloseTo(0.2, 5)
  })

  it('ignores the activation week unless it met cadence (D-21)', () => {
    // Activated mid-W3, did 1 of 4 that week. W3 must not count, and nothing
    // before activation counts either, so the window is entirely excluded.
    const done = daysIn(W3, 1)
    expect(completionRate(done, TODAY, '2026-09-03', 4)).toBe(0)
  })

  it('returns 0 when the habit was never activated', () => {
    expect(completionRate([], TODAY, null, 4)).toBe(0)
  })
})

describe('currentStreak in weeks (D-25)', () => {
  it('counts consecutive complete weeks that met cadence', () => {
    const done = [...daysIn(W1, 4), ...daysIn(W2, 4), ...daysIn(W3, 4)]
    expect(currentStreak(done, TODAY, ACTIVATED, 4)).toBe(3)
  })

  it('is not broken by a week in progress that has not met cadence yet', () => {
    const done = [...daysIn(W2, 4), ...daysIn(W3, 4), ...daysIn(W4, 1)]
    expect(currentStreak(done, TODAY, ACTIVATED, 4)).toBe(2)
  })

  it('includes the week in progress once it has met cadence', () => {
    const done = [...daysIn(W2, 4), ...daysIn(W3, 4), ...daysIn(W4, 4)]
    expect(currentStreak(done, TODAY, ACTIVATED, 4)).toBe(3)
  })

  it('breaks on a complete week that missed cadence', () => {
    const done = [...daysIn(W1, 4), ...daysIn(W2, 1), ...daysIn(W3, 4)]
    expect(currentStreak(done, TODAY, ACTIVATED, 4)).toBe(1)
  })

  it('is 0 with nothing logged', () => {
    expect(currentStreak([], TODAY, ACTIVATED, 4)).toBe(0)
  })
})

describe('classifyHealth with cadence', () => {
  it('is new inside the grace period', () => {
    expect(classifyHealth([], TODAY, '2026-09-07', 4)).toBe('new')
  })

  it('rates a perfectly kept 4x/week habit consistent, which it never could before', () => {
    const done = [...daysIn(W0, 4), ...daysIn(W1, 4), ...daysIn(W2, 4), ...daysIn(W3, 4)]
    expect(classifyHealth(done, TODAY, ACTIVATED, 4)).toBe('consistent')
  })

  it('rates a perfectly kept weekly habit consistent, not struggling', () => {
    const done = [...daysIn(W0, 1), ...daysIn(W1, 1), ...daysIn(W2, 1), ...daysIn(W3, 1)]
    expect(classifyHealth(done, TODAY, ACTIVATED, 1)).toBe('consistent')
  })

  it('still calls a genuinely neglected habit struggling', () => {
    expect(classifyHealth(daysIn(W1, 1), TODAY, ACTIVATED, 4)).toBe('struggling')
  })
})

/**
 * Grace is about accumulated evidence, not elapsed calendar time (D-...,
 * item 4 of the final-fixes brief). The activation week and an unmet current
 * week are both excluded from what counts, so "two calendar weeks since
 * activation" is not the same thing as "two counted weeks" — these pin the
 * count directly rather than the elapsed time that used to stand in for it.
 */
describe('grace counts scorable weeks, not elapsed calendar time', () => {
  it('is new with exactly one counted week', () => {
    // Activated at the start of W2: W2 itself is the activation week (only
    // counts if met, and nothing is logged), so only W3 is settled. One
    // counted week is not enough evidence to judge.
    expect(classifyHealth([], TODAY, W2, 4)).toBe('new')
  })

  it('is judged once two weeks are counted', () => {
    // Activated at the start of W1: W2 and W3 are both settled (complete and
    // after activation), regardless of whether they were met. Two counted
    // weeks with nothing logged score 0 — struggling, not new.
    expect(classifyHealth([], TODAY, W1, 4)).toBe('struggling')
  })
})

describe('weekSummaries', () => {
  it('reports the scoring window plus the current week, ascending', () => {
    const summaries = weekSummaries(daysIn(W3, 2), TODAY, ACTIVATED, 4)
    expect(summaries.map(s => s.start)).toEqual([W0, W1, W2, W3, W4])
  })

  it('reports completed, expected and met per week', () => {
    const summaries = weekSummaries(daysIn(W3, 4), TODAY, ACTIVATED, 4)
    const third = summaries.find(s => s.start === W3)!
    expect(third).toEqual({ start: W3, completed: 4, expected: 4, met: true })
  })

  it('counts days beyond cadence without marking more than met', () => {
    const summaries = weekSummaries(daysIn(W3, 6), TODAY, ACTIVATED, 4)
    const third = summaries.find(s => s.start === W3)!
    expect(third.completed).toBe(6)
    expect(third.met).toBe(true)
  })
})

describe('summariseWeeks', () => {
  it('reports one summary per given week start, in the order given', () => {
    const done = [...daysIn(W1, 4), ...daysIn(W3, 2)]
    const summaries = summariseWeeks(done, [W3, W1], 4)
    expect(summaries).toEqual([
      { start: W3, completed: 2, expected: 4, met: false },
      { start: W1, completed: 4, expected: 4, met: true },
    ])
  })

  it('is not gated by activation — it just summarises the weeks it is given', () => {
    // Unlike weekSummaries, this has no activatedAt to check: a dashboard's
    // rendered range can predate activation entirely.
    expect(summariseWeeks([], [W0], 4)).toEqual([
      { start: W0, completed: 0, expected: 4, met: false },
    ])
  })
})

describe('streak tolerance (D-25a)', () => {
  it('keeps a daily habit’s streak alive at six of seven', () => {
    // The case that motivated the tolerance: without it this is 0 forever.
    const done = [...daysIn(W1, 6), ...daysIn(W2, 6), ...daysIn(W3, 6)]
    expect(currentStreak(done, TODAY, ACTIVATED, 7)).toBe(3)
  })

  it('forgives one short of a 4x cadence', () => {
    const done = [...daysIn(W1, 3), ...daysIn(W2, 4), ...daysIn(W3, 3)]
    expect(currentStreak(done, TODAY, ACTIVATED, 4)).toBe(3)
  })

  it('does not forgive two short', () => {
    const done = [...daysIn(W1, 4), ...daysIn(W2, 2), ...daysIn(W3, 4)]
    expect(currentStreak(done, TODAY, ACTIVATED, 4)).toBe(1)
  })

  it('never forgives an empty week, whatever the cadence', () => {
    // The floor. "One short" of a cadence of 1 would be none, and a weekly
    // habit never done at all would otherwise keep its streak forever.
    expect(currentStreak([], TODAY, ACTIVATED, 1)).toBe(0)
    expect(currentStreak([], TODAY, ACTIVATED, 7)).toBe(0)
  })

  it('still requires the full cadence for a 1x habit', () => {
    const done = [...daysIn(W1, 1), ...daysIn(W2, 1), ...daysIn(W3, 1)]
    expect(currentStreak(done, TODAY, ACTIVATED, 1)).toBe(3)
  })

  it('leaves the rate strict — tolerance is streak-only', () => {
    // 6 of 7 is a kept streak but NOT a met week: the rate must still show
    // it, across all four scored complete weeks (W0-W3): 6/7 each, average
    // 6/7.
    const done = [...daysIn(W0, 6), ...daysIn(W1, 6), ...daysIn(W2, 6), ...daysIn(W3, 6)]
    expect(completionRate(done, TODAY, ACTIVATED, 7)).toBeCloseTo(6 / 7, 5)
  })
})
