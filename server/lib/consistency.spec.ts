import { describe, expect, it } from 'vitest'
import {
  classifyHealth, completionRate, currentStreak, weekSummaries,
} from './consistency.js'
import { weekDays } from './date.js'

// Monday 2026-08-17, 2026-08-24, 2026-08-31, 2026-09-07. "Today" is Wed 2026-09-09.
const TODAY = '2026-09-09'
const ACTIVATED = '2026-06-01'

/** The first `n` days of the week starting `weekStart`, Monday onward. */
function daysIn(weekStart: string, n: number): string[] {
  return weekDays(weekStart).slice(0, n)
}

const W1 = '2026-08-17'
const W2 = '2026-08-24'
const W3 = '2026-08-31'
const W4 = '2026-09-07' // the week containing TODAY — incomplete

describe('completionRate with cadence', () => {
  it('scores a 4x/week habit kept exactly as 1.0', () => {
    const done = [...daysIn(W1, 4), ...daysIn(W2, 4), ...daysIn(W3, 4)]
    expect(completionRate(done, TODAY, ACTIVATED, 4)).toBe(1)
  })

  it('scores a 1x/week habit kept exactly as 1.0', () => {
    const done = [...daysIn(W1, 1), ...daysIn(W2, 1), ...daysIn(W3, 1)]
    expect(completionRate(done, TODAY, ACTIVATED, 1)).toBe(1)
  })

  it('caps a week at 100% and does not carry the surplus (D-22)', () => {
    // W1 is also in the 4-week window, complete, and long after activation —
    // it counts as a genuine zero, same as the adjacent "week in progress"
    // test below treats W1-W3 as complete-and-empty. So the window here is
    // W1 (0/4=0), W2 (6/4 capped to 1), W3 (2/4=0.5): average 0.5, not 0.75 —
    // 6 then 2 against a cadence of 4 caps, it does not carry the surplus.
    const done = [...daysIn(W2, 6), ...daysIn(W3, 2)]
    expect(completionRate(done, TODAY, ACTIVATED, 4)).toBeCloseTo(0.5, 5)
  })

  it('ignores an unmet week in progress (D-21)', () => {
    const done = [...daysIn(W1, 4), ...daysIn(W2, 4), ...daysIn(W3, 4), ...daysIn(W4, 1)]
    // The single day of the current week must not drag 1.0 down.
    expect(completionRate(done, TODAY, ACTIVATED, 4)).toBe(1)
  })

  it('counts a week in progress once it has met cadence (D-21)', () => {
    const done = [...daysIn(W3, 0), ...daysIn(W4, 2)]
    // W4 met a cadence of 2, so it counts; W1-W3 are complete and empty.
    expect(completionRate(done, TODAY, ACTIVATED, 2)).toBeCloseTo(0.25, 5)
  })

  it('ignores the activation week unless it met cadence (D-21)', () => {
    // Activated mid-W3, did 1 of 4 that week. W3 must not count.
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
    const done = [...daysIn(W1, 4), ...daysIn(W2, 4), ...daysIn(W3, 4)]
    expect(classifyHealth(done, TODAY, ACTIVATED, 4)).toBe('consistent')
  })

  it('rates a perfectly kept weekly habit consistent, not struggling', () => {
    const done = [...daysIn(W1, 1), ...daysIn(W2, 1), ...daysIn(W3, 1)]
    expect(classifyHealth(done, TODAY, ACTIVATED, 1)).toBe('consistent')
  })

  it('still calls a genuinely neglected habit struggling', () => {
    expect(classifyHealth(daysIn(W1, 1), TODAY, ACTIVATED, 4)).toBe('struggling')
  })
})

describe('weekSummaries', () => {
  it('reports every window week plus the current one, ascending', () => {
    const summaries = weekSummaries(daysIn(W3, 2), TODAY, ACTIVATED, 4)
    expect(summaries.map(s => s.start)).toEqual([W1, W2, W3, W4])
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
