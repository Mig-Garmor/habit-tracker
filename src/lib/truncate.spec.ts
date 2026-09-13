import { describe, expect, it } from 'vitest'
import { isTruncated, NAME_LIMIT, truncateName } from './truncate'

describe('truncateName', () => {
  it('leaves a short name alone', () => {
    expect(truncateName('Exercise')).toBe('Exercise')
  })

  it('leaves a name of exactly the limit alone', () => {
    const exact = 'a'.repeat(NAME_LIMIT)
    expect(truncateName(exact)).toBe(exact)
  })

  it('never returns more than the limit, ellipsis included', () => {
    // The point of the limit is that every row is the same width, so the
    // ellipsis has to count toward it rather than be added on top.
    const result = truncateName('Record one video')
    // At MOST the limit — trimming the space before the ellipsis can leave it
    // a character shorter, which is the point, not a miss.
    expect(result.length).toBeLessThanOrEqual(NAME_LIMIT)
    expect(result).toBe('Record one…')
  })

  it('drops a trailing space before the ellipsis', () => {
    // 'Record one …' reads as a mistake; 'Record one…' reads as a cut.
    expect(truncateName('Record one  video')).not.toMatch(/ …$/)
  })

  it('handles a name that is one character too long', () => {
    const result = truncateName('a'.repeat(NAME_LIMIT + 1))
    expect(result.length).toBe(NAME_LIMIT)  // no space to trim here
    expect(result.endsWith('…')).toBe(true)
  })

  it('handles an empty name without throwing', () => {
    expect(truncateName('')).toBe('')
  })

  it('respects a custom limit', () => {
    expect(truncateName('Meditation', 5)).toBe('Medi…')
  })
})

describe('isTruncated', () => {
  it('is false when the whole name is shown', () => {
    expect(isTruncated('Exercise')).toBe(false)
    expect(isTruncated('a'.repeat(NAME_LIMIT))).toBe(false)
  })

  it('is true when it is cut, so a tooltip is worth offering', () => {
    expect(isTruncated('Record one video')).toBe(true)
  })
})
