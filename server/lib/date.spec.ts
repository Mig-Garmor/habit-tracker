import { describe, expect, it } from 'vitest'
import { currentStreak, previousDay, toDateKey } from './date'

describe('toDateKey', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(toDateKey(new Date(2026, 8, 11))).toBe('2026-09-11')
  })

  it('pads single-digit months and days', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('keeps late-evening times on the same local day', () => {
    expect(toDateKey(new Date(2026, 8, 11, 23, 59))).toBe('2026-09-11')
  })
})

describe('previousDay', () => {
  it('steps back one day', () => {
    expect(previousDay('2026-09-11')).toBe('2026-09-10')
  })

  it('rolls back across a month boundary', () => {
    expect(previousDay('2026-09-01')).toBe('2026-08-31')
  })

  it('rolls back across a year boundary', () => {
    expect(previousDay('2026-01-01')).toBe('2025-12-31')
  })
})

describe('currentStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(currentStreak(['2026-09-09', '2026-09-10', '2026-09-11'], '2026-09-11')).toBe(3)
  })

  it('is 0 when today is not completed', () => {
    expect(currentStreak(['2026-09-09', '2026-09-10'], '2026-09-11')).toBe(0)
  })

  it('stops at the first gap', () => {
    expect(currentStreak(['2026-09-08', '2026-09-10', '2026-09-11'], '2026-09-11')).toBe(2)
  })

  it('is 0 for no history', () => {
    expect(currentStreak([], '2026-09-11')).toBe(0)
  })
})
