import { describe, expect, it } from 'vitest'
import { deriveEntry, EntryRuleError } from './entry-rules.js'

const checklist = { id: 3, kind: 'checklist' as const }
const STEPS = [11, 12, 13, 14, 15]

describe('deriveEntry', () => {
  it('leaves a tick as it was (D-1)', () => {
    expect(deriveEntry({ id: 1, kind: 'binary' }, [], { completed: true }, null))
      .toEqual({ completed: true, value: null, note: null, steps: null })
  })

  it('derives an amount from its value (D-1)', () => {
    expect(deriveEntry({ id: 1, kind: 'quantity' }, [], { value: 5, completed: false }, null))
      .toMatchObject({ completed: true, value: 5 })
  })

  it('counts ticked steps as the value and showing up as done (D-30)', () => {
    expect(deriveEntry(checklist, STEPS, { steps: [11, 13] }, null))
      .toEqual({ completed: true, value: 2, note: null, steps: [11, 13] })
  })

  it('is not done with nothing ticked', () => {
    expect(deriveEntry(checklist, STEPS, { steps: [] }, null))
      .toMatchObject({ completed: false, value: 0, steps: [] })
  })

  it('keeps the stored ticks when steps are omitted, as an omitted note is kept (D-6)', () => {
    expect(deriveEntry(checklist, STEPS, { note: 'Ship #1576' }, { completed: true, value: 1, note: null, steps: [12] }))
      .toEqual({ completed: true, value: 1, note: 'Ship #1576', steps: [12] })
  })

  it('counts a step ticked twice once', () => {
    expect(deriveEntry(checklist, STEPS, { steps: [11, 11] }, null)).toMatchObject({ value: 1, steps: [11] })
  })

  it('refuses a step that belongs to another habit', () => {
    expect(() => deriveEntry(checklist, STEPS, { steps: [99] }, null)).toThrow(EntryRuleError)
    expect(() => deriveEntry(checklist, STEPS, { steps: [99] }, null))
      .toThrow('Step 99 does not belong to habit 3')
  })

  it('treats a checklist with no steps yet as a plain tick', () => {
    expect(deriveEntry(checklist, [], { completed: true }, null))
      .toEqual({ completed: true, value: null, note: null, steps: null })
  })

  it('completes a journal by its note and nothing else (D-32)', () => {
    const journal = { id: 4, kind: 'journal' as const }
    expect(deriveEntry(journal, [], { note: '  Reviewed #1576  ', completed: false }, null))
      .toEqual({ completed: true, value: null, note: 'Reviewed #1576', steps: null })
    expect(deriveEntry(journal, [], { note: '', completed: true }, { completed: true, value: null, note: 'old', steps: null }))
      .toMatchObject({ completed: false, note: null })
  })

  it('keeps a stored journal note when the note is omitted', () => {
    expect(deriveEntry({ id: 4, kind: 'journal' }, [], {}, { completed: true, value: null, note: 'kept', steps: null }))
      .toMatchObject({ completed: true, note: 'kept' })
  })
})

describe('a note sent on its own (review C1)', () => {
  const stored = (over: Partial<{ completed: boolean, value: number | null, note: string | null, steps: number[] | null }>) =>
    ({ completed: false, value: null, note: null, steps: null, ...over })

  it('keeps a ticked habit ticked', () => {
    expect(deriveEntry({ id: 1, kind: 'binary' }, [], { note: '45 min run' }, stored({ completed: true })))
      .toEqual({ completed: true, value: null, note: '45 min run', steps: null })
  })

  it('keeps an amount', () => {
    expect(deriveEntry({ id: 2, kind: 'quantity' }, [], { note: 'chapter 4' }, stored({ completed: true, value: 30 })))
      .toMatchObject({ completed: true, value: 30, note: 'chapter 4' })
  })

  it('keeps a checklist with no steps ticked', () => {
    expect(deriveEntry({ id: 3, kind: 'checklist' }, [], { note: 'all fine' }, stored({ completed: true })))
      .toMatchObject({ completed: true, note: 'all fine' })
  })

  it('ignores ticks a stale page sends for a checklist that no longer has steps (review I4)', () => {
    expect(deriveEntry({ id: 3, kind: 'checklist' }, [], { steps: [11] }, stored({ completed: true })))
      .toMatchObject({ completed: true })
  })
})
