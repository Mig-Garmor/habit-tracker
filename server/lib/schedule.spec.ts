import { describe, expect, it } from 'vitest'
import { habitProgress, isoWeekday, isScheduled, owedFrom, slotProgress } from './schedule.js'

// The week of 2026-11-02, Monday, to 2026-11-08, Sunday.
const MON = '2026-11-02'
const TUE = '2026-11-03'
const WED = '2026-11-04'
const SUN = '2026-11-08'

const planTheWeek = { weekdays: [1], timesPerWeek: 1 }
const workdays = { weekdays: [1, 2, 3, 4, 5], timesPerWeek: 5 }

describe('isoWeekday', () => {
  it('numbers Monday 1 and Sunday 7', () => {
    expect(isoWeekday(MON)).toBe(1)
    expect(isoWeekday(SUN)).toBe(7)
  })
})

describe('isScheduled', () => {
  it('lists a Monday-only habit on Monday and not on Tuesday', () => {
    expect(isScheduled(planTheWeek, MON)).toBe(true)
    expect(isScheduled(planTheWeek, TUE)).toBe(false)
  })
})

describe('owedFrom (D-31)', () => {
  it('is not owed on its own scheduled day', () => {
    expect(owedFrom(planTheWeek, MON, [])).toBeNull()
  })

  it('carries an unlogged Monday into Tuesday and on to Sunday', () => {
    expect(owedFrom(planTheWeek, TUE, [])).toBe(MON)
    expect(owedFrom(planTheWeek, SUN, [])).toBe(MON)
  })

  it('stops carrying once done on the day', () => {
    expect(owedFrom(planTheWeek, TUE, [MON])).toBeNull()
  })

  it('stays listed on the day it is caught up, so ticking it does not make it vanish', () => {
    expect(owedFrom(planTheWeek, TUE, [TUE])).toBe(MON)
    expect(owedFrom(planTheWeek, WED, [TUE])).toBeNull()
  })

  it('names the earliest unmet day', () => {
    expect(owedFrom(workdays, WED, [TUE])).toBe(MON)
  })

  it('never owes more than the weekly cadence', () => {
    const twiceAWeek = { weekdays: [1, 2, 3, 4, 5, 6, 7], timesPerWeek: 2 }
    expect(owedFrom(twiceAWeek, WED, [MON, TUE])).toBeNull()
  })

  it('ignores last week', () => {
    expect(owedFrom(planTheWeek, MON, ['2026-10-26'])).toBeNull()
    expect(owedFrom(planTheWeek, '2026-11-09', [])).toBeNull()
  })
})

describe('habitProgress (D-33)', () => {
  it('is all or nothing for a tick', () => {
    expect(habitProgress({ kind: 'binary', target: null }, { completed: true, value: null })).toBe(1)
    expect(habitProgress({ kind: 'binary', target: null }, null)).toBe(0)
  })

  it('is all or nothing for a journal', () => {
    expect(habitProgress({ kind: 'journal', target: null }, { completed: true, value: null })).toBe(1)
  })

  it('is the share of the target for an amount, capped at one', () => {
    expect(habitProgress({ kind: 'quantity', target: 15 }, { completed: true, value: 7.5 })).toBe(0.5)
    expect(habitProgress({ kind: 'quantity', target: 15 }, { completed: true, value: 30 })).toBe(1)
  })

  it('is the share of steps ticked for a checklist', () => {
    expect(habitProgress({ kind: 'checklist', target: 5 }, { completed: true, value: 2 })).toBe(0.4)
  })

  it('falls back to the tick for a checklist with no steps yet', () => {
    expect(habitProgress({ kind: 'checklist', target: 0 }, { completed: true, value: null })).toBe(1)
    expect(habitProgress({ kind: 'checklist', target: null }, null)).toBe(0)
  })
})

describe('slotProgress (D-33)', () => {
  it('averages progress and counts what is done', () => {
    expect(slotProgress([
      { progress: 1, completed: true },
      { progress: 0.4, completed: true },
      { progress: 0, completed: false },
      { progress: 0.6, completed: true },
    ])).toEqual({ progress: 0.5, done: 3, total: 4 })
  })

  it('is empty, not NaN, for a slot with nothing in it', () => {
    expect(slotProgress([])).toEqual({ progress: 0, done: 0, total: 0 })
  })
})
