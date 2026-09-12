import { describe, expect, it } from 'vitest'
import { classifyHealth, completionRate } from './consistency'
import { lastNDays, previousDay } from './date'

const TODAY = '2026-09-30'

/** A habit activated long enough ago that the grace period never applies. */
const LONG_AGO = '2026-01-01'

/** The `count` most recent days ending at TODAY. */
function recentDays(count: number): string[] {
  return lastNDays(count, TODAY)
}

describe('completionRate', () => {
  it('is 0 with no completed days', () => {
    expect(completionRate([], TODAY, LONG_AGO)).toBe(0)
  })

  it('is 1 when every day in the window is completed', () => {
    expect(completionRate(recentDays(14), TODAY, LONG_AGO)).toBe(1)
  })

  it('counts only the trailing 14 days', () => {
    // 30 completed days, but the window is 14 — still a perfect rate, not 2.1.
    expect(completionRate(recentDays(30), TODAY, LONG_AGO)).toBe(1)
  })

  it('is a half for 7 of the last 14', () => {
    expect(completionRate(recentDays(7), TODAY, LONG_AGO)).toBe(0.5)
  })

  it('ignores days older than the window', () => {
    const old = lastNDays(10, previousDay(lastNDays(14, TODAY)[0]!))
    expect(completionRate(old, TODAY, LONG_AGO)).toBe(0)
  })

  it('judges a young habit only on days since it was activated', () => {
    // Activated 4 days ago, did 2 of those 4 — that is 0.5, not 2/14.
    const activatedAt = lastNDays(4, TODAY)[0]!
    expect(completionRate(recentDays(2), TODAY, activatedAt)).toBe(0.5)
  })

  it('is 0 when the habit has never been activated', () => {
    expect(completionRate(recentDays(5), TODAY, null)).toBe(0)
  })
})

describe('classifyHealth', () => {
  it('is new inside the grace period, however badly it is going', () => {
    const activatedAt = lastNDays(13, TODAY)[0]!
    expect(classifyHealth([], TODAY, activatedAt)).toBe('new')
  })

  it('leaves the grace period on day 14', () => {
    const activatedAt = lastNDays(15, TODAY)[0]!
    expect(classifyHealth([], TODAY, activatedAt)).toBe('struggling')
  })

  it('is new when never activated', () => {
    expect(classifyHealth([], TODAY, null)).toBe('new')
  })

  it('is struggling below half', () => {
    // 6 of 14 is 0.43
    expect(classifyHealth(recentDays(6), TODAY, LONG_AGO)).toBe('struggling')
  })

  it('is steady at exactly half', () => {
    expect(classifyHealth(recentDays(7), TODAY, LONG_AGO)).toBe('steady')
  })

  it('is steady between the thresholds', () => {
    // 10 of 14 is 0.71
    expect(classifyHealth(recentDays(10), TODAY, LONG_AGO)).toBe('steady')
  })

  it('is consistent at exactly the upper threshold', () => {
    // 12 of 14 is 0.857; 11 of 14 is 0.786 and must not qualify
    expect(classifyHealth(recentDays(12), TODAY, LONG_AGO)).toBe('consistent')
    expect(classifyHealth(recentDays(11), TODAY, LONG_AGO)).toBe('steady')
  })

  it('is consistent at a perfect rate', () => {
    expect(classifyHealth(recentDays(14), TODAY, LONG_AGO)).toBe('consistent')
  })
})
