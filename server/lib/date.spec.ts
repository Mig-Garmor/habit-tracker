import { describe, expect, it } from 'vitest'
import { currentStreak, dateRange, isValidDateKey, isWeekComplete, lastNDays, lastNWeekStarts, nextDay, nextWeek, previousDay, previousWeek, startOfWeek, toDateKey, weekDays } from './date.js'

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

describe('nextDay', () => {
  it('steps forward one day', () => {
    expect(nextDay('2026-09-11')).toBe('2026-09-12')
  })

  it('rolls forward across a month boundary', () => {
    expect(nextDay('2026-08-31')).toBe('2026-09-01')
  })

  it('rolls forward across a year boundary', () => {
    expect(nextDay('2025-12-31')).toBe('2026-01-01')
  })
})

describe('isValidDateKey', () => {
  it('accepts a well-formed key', () => {
    expect(isValidDateKey('2026-09-11')).toBe(true)
  })

  it('rejects the wrong shape', () => {
    expect(isValidDateKey('2026-9-11')).toBe(false)
    expect(isValidDateKey('11-09-2026')).toBe(false)
    expect(isValidDateKey('')).toBe(false)
  })

  it('rejects a date that does not exist', () => {
    expect(isValidDateKey('2026-02-30')).toBe(false)
    expect(isValidDateKey('2026-13-01')).toBe(false)
  })
})

describe('dateRange', () => {
  it('includes both ends', () => {
    expect(dateRange('2026-09-09', '2026-09-12')).toEqual([
      '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12',
    ])
  })

  it('returns a single day when both ends match', () => {
    expect(dateRange('2026-09-09', '2026-09-09')).toEqual(['2026-09-09'])
  })

  it('crosses a month boundary', () => {
    expect(dateRange('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
    ])
  })

  it('is empty when from is after to', () => {
    expect(dateRange('2026-09-12', '2026-09-09')).toEqual([])
  })
})

describe('lastNDays', () => {
  it('returns n days ascending, ending at upTo', () => {
    expect(lastNDays(3, '2026-09-12')).toEqual(['2026-09-10', '2026-09-11', '2026-09-12'])
  })

  it('returns just upTo for n of 1', () => {
    expect(lastNDays(1, '2026-09-12')).toEqual(['2026-09-12'])
  })

  it('is empty for n of 0', () => {
    expect(lastNDays(0, '2026-09-12')).toEqual([])
  })
})

describe('startOfWeek', () => {
  it('returns the same day when it is already Monday', () => {
    expect(startOfWeek('2026-09-07')).toBe('2026-09-07')
  })

  it('walks back to Monday from a Saturday', () => {
    expect(startOfWeek('2026-09-12')).toBe('2026-09-07')
  })

  it('walks back to Monday from a Sunday', () => {
    expect(startOfWeek('2026-09-13')).toBe('2026-09-07')
  })

  it('crosses a month boundary', () => {
    expect(startOfWeek('2026-09-02')).toBe('2026-08-31')
  })
})

describe('currentStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(currentStreak(['2026-09-09', '2026-09-10', '2026-09-11'], '2026-09-11')).toBe(3)
  })

  it('stops at the first gap', () => {
    expect(currentStreak(['2026-09-08', '2026-09-10', '2026-09-11'], '2026-09-11')).toBe(2)
  })

  it('is 0 for no history', () => {
    expect(currentStreak([], '2026-09-11')).toBe(0)
  })

  it('counts back from an unlogged today (D-4)', () => {
    expect(currentStreak(['2026-09-09', '2026-09-10', '2026-09-11'], '2026-09-12')).toBe(3)
  })

  it('includes today when today is completed', () => {
    expect(currentStreak(['2026-09-11', '2026-09-12'], '2026-09-12')).toBe(2)
  })

  it('is 0 when neither today nor yesterday is completed', () => {
    expect(currentStreak(['2026-09-09', '2026-09-10'], '2026-09-12')).toBe(0)
  })
})

describe('lastNWeekStarts', () => {
  it('ends with the week containing the given day', () => {
    // 2026-09-13 is a Sunday; its week starts Monday 2026-09-07.
    expect(lastNWeekStarts(1, '2026-09-13')).toEqual(['2026-09-07'])
  })

  it('walks back whole weeks, ascending', () => {
    expect(lastNWeekStarts(3, '2026-09-13')).toEqual(['2026-08-24', '2026-08-31', '2026-09-07'])
  })

  it('works when the day is itself a Monday', () => {
    expect(lastNWeekStarts(2, '2026-09-07')).toEqual(['2026-08-31', '2026-09-07'])
  })

  it('returns nothing for a non-positive count', () => {
    expect(lastNWeekStarts(0, '2026-09-13')).toEqual([])
  })
})

describe('weekDays', () => {
  it('returns seven days, Monday first', () => {
    expect(weekDays('2026-09-07')).toEqual([
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
      '2026-09-11', '2026-09-12', '2026-09-13',
    ])
  })

  it('crosses a month boundary', () => {
    expect(weekDays('2026-08-31')[6]).toBe('2026-09-06')
  })
})

describe('nextWeek and previousWeek', () => {
  it('advance and retreat exactly seven days', () => {
    expect(nextWeek('2026-08-31')).toBe('2026-09-07')
    expect(previousWeek('2026-09-07')).toBe('2026-08-31')
  })

  it('cross a month boundary', () => {
    expect(nextWeek('2026-08-24')).toBe('2026-08-31')
    expect(previousWeek('2026-09-07')).toBe('2026-08-31')
  })

  it('round-trip', () => {
    expect(previousWeek(nextWeek('2026-09-07'))).toBe('2026-09-07')
  })
})

describe('isWeekComplete', () => {
  it('is false for the week containing today', () => {
    expect(isWeekComplete('2026-09-07', '2026-09-13')).toBe(false)
  })

  it('is false on the last day of the week, which has not finished', () => {
    expect(isWeekComplete('2026-09-07', '2026-09-13')).toBe(false)
  })

  it('is true once the week is entirely past', () => {
    expect(isWeekComplete('2026-08-31', '2026-09-07')).toBe(true)
  })
})
