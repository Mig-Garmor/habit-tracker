import { describe, expect, it } from 'vitest'
import { activityLevel } from './level.js'

const binary = { kind: 'binary' as const, target: null }
const meditation = { kind: 'quantity' as const, target: 10 }

describe('activityLevel', () => {
  it('is 0 when there is no entry', () => {
    expect(activityLevel(binary, null)).toBe(0)
    expect(activityLevel(meditation, undefined)).toBe(0)
  })

  describe('binary habits', () => {
    it('is 3 when completed', () => {
      expect(activityLevel(binary, { completed: true, value: null })).toBe(3)
    })

    it('is 0 when not completed', () => {
      expect(activityLevel(binary, { completed: false, value: null })).toBe(0)
    })
  })

  describe('quantity habits against a target of 10', () => {
    it('is 0 for a logged zero', () => {
      expect(activityLevel(meditation, { completed: false, value: 0 })).toBe(0)
    })

    it('is 1 below half the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 4 })).toBe(1)
    })

    it('is 2 at exactly half the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 5 })).toBe(2)
    })

    it('is 2 just under the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 9 })).toBe(2)
    })

    it('is 3 at exactly the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 10 })).toBe(3)
    })

    it('is 3 just under 1.5x the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 14 })).toBe(3)
    })

    it('is 4 at 1.5x the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 15 })).toBe(4)
    })

    it('is 4 well over the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 60 })).toBe(4)
    })
  })

  it('keeps the old 5-minute days lighter than new 10-minute days (D-2)', () => {
    const fiveMinuteDay = activityLevel(meditation, { completed: true, value: 5 })
    const tenMinuteDay = activityLevel(meditation, { completed: true, value: 10 })
    expect(fiveMinuteDay).toBeLessThan(tenMinuteDay)
  })

  describe('quantity habits without a usable target', () => {
    it('falls back to binary shading', () => {
      const noTarget = { kind: 'quantity' as const, target: null }
      expect(activityLevel(noTarget, { completed: true, value: 7 })).toBe(3)
      expect(activityLevel(noTarget, { completed: false, value: 0 })).toBe(0)
    })

    it('treats a zero target as unusable rather than dividing by it', () => {
      const zeroTarget = { kind: 'quantity' as const, target: 0 }
      expect(activityLevel(zeroTarget, { completed: true, value: 7 })).toBe(3)
    })
  })
})
