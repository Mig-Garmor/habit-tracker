import { describe, expect, it } from 'vitest'
import { dateKey, EVENING_STARTS_AT, frontSlot, morningVisible } from './day-part'

// 2026-11-06 is a Friday; local time throughout, as the browser sees it.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute)

describe('frontSlot (D-29)', () => {
  it('switches at five o’clock', () => {
    expect(EVENING_STARTS_AT).toBe(17)
  })

  it('puts the morning in front on a weekday afternoon', () => {
    expect(frontSlot(at(6, 16, 59))).toBe('morning')
  })

  it('puts the evening in front from five', () => {
    expect(frontSlot(at(6, 17, 0))).toBe('evening')
  })

  it('starts a Monday in the morning, just after midnight', () => {
    expect(frontSlot(at(9, 0, 0))).toBe('morning')
  })

  it('keeps the evening in front all weekend, even at nine in the morning', () => {
    expect(frontSlot(at(7, 9, 0))).toBe('evening')
    expect(frontSlot(at(8, 9, 0))).toBe('evening')
  })
})

describe('morningVisible', () => {
  it('shows the morning on weekdays and hides it at the weekend', () => {
    expect(morningVisible(at(6, 20))).toBe(true)
    expect(morningVisible(at(7, 9))).toBe(false)
    expect(morningVisible(at(8, 9))).toBe(false)
  })
})

describe('dateKey', () => {
  it('formats the local calendar day, not the UTC one', () => {
    expect(dateKey(at(6, 23, 30))).toBe('2026-11-06')
  })
})
