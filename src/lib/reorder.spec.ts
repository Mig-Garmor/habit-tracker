import { describe, expect, it } from 'vitest'
import { indexForPointer, moveItem } from './reorder'

describe('moveItem', () => {
  const items = ['a', 'b', 'c', 'd']

  it('moves an item down', () => {
    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves an item up', () => {
    expect(moveItem(items, 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('leaves the array alone when the item does not move', () => {
    expect(moveItem(items, 2, 2)).toEqual(items)
  })

  it('clamps a target past the end rather than dropping the item', () => {
    // Arrow-key reordering at the last row would otherwise lose it.
    expect(moveItem(items, 0, 99)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('clamps a negative target', () => {
    expect(moveItem(items, 2, -5)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('ignores an out-of-range source', () => {
    expect(moveItem(items, 9, 0)).toEqual(items)
  })

  it('does not mutate the input', () => {
    const original = [...items]
    moveItem(items, 0, 3)
    expect(items).toEqual(original)
  })
})

describe('indexForPointer', () => {
  // Four 20px rows starting at y=0.
  const rows = [
    { top: 0, height: 20 },
    { top: 20, height: 20 },
    { top: 40, height: 20 },
    { top: 60, height: 20 },
  ]

  it('picks a row once the pointer passes its midpoint, not its edge', () => {
    // Still in the first row's lower half -> has not reached row 1's midpoint.
    expect(indexForPointer(rows, 19)).toBe(1)
    // Just above row 1's midpoint (30).
    expect(indexForPointer(rows, 29)).toBe(1)
    // Past it.
    expect(indexForPointer(rows, 31)).toBe(2)
  })

  it('returns the first index above the whole list', () => {
    expect(indexForPointer(rows, -50)).toBe(0)
  })

  it('returns the last index below the whole list, so a row can be dropped at the end', () => {
    expect(indexForPointer(rows, 500)).toBe(3)
  })

  it('handles an empty list without throwing', () => {
    expect(indexForPointer([], 10)).toBe(0)
  })
})
