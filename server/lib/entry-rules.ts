import type { HabitKind } from '../db/schema.js'

/**
 * What a day's entry stores, decided by the server from what the client sent
 * and what is already there. The client never decides `completed` (D-1).
 */

export interface EntryInput {
  completed?: boolean
  value?: number | null
  note?: string | null
  steps?: number[]
}

export interface StoredEntry {
  completed: boolean
  value: number | null
  note: string | null
  steps: number[] | null
}

export interface DerivedEntry {
  completed: boolean
  value: number | null
  note: string | null
  steps: number[] | null
}

export class EntryRuleError extends Error {}

/**
 * An omitted note keeps whatever is stored, so turning notes off never destroys
 * one (D-6). Only an explicit note replaces it; blank means none.
 */
function mergeNote(input: EntryInput, existing: StoredEntry | null): string | null {
  if (input.note === undefined) return existing?.note ?? null
  return input.note?.trim() ? input.note.trim() : null
}

/** `stepIds` are the habit's current steps, in any order. */
export function deriveEntry(
  habit: { id: number, kind: HabitKind },
  stepIds: number[],
  input: EntryInput,
  existing: StoredEntry | null,
): DerivedEntry {
  const note = mergeNote(input, existing)

  if (habit.kind === 'quantity') {
    // Omitted keeps what is stored, as a note does (D-6): saving only a note
    // must never zero the day's amount.
    const value = input.value === undefined ? (existing?.value ?? 0) : (input.value ?? 0)
    return { completed: value > 0, value, note, steps: null }
  }

  if (habit.kind === 'journal') {
    return { completed: note !== null, value: null, note, steps: null }
  }

  // A checklist before any steps are added is a plain tick, or it could never
  // be done at all (D-30).
  if (habit.kind === 'checklist' && stepIds.length > 0) {
    const known = new Set(stepIds)
    const foreign = input.steps?.find(id => !known.has(id))
    if (foreign !== undefined) {
      throw new EntryRuleError(`Step ${foreign} does not belong to habit ${habit.id}`)
    }
    // Stored ticks can name a step deleted since; those simply stop counting.
    const ticked = [...new Set(input.steps ?? existing?.steps ?? [])].filter(id => known.has(id))
    return { completed: ticked.length > 0, value: ticked.length, note, steps: ticked }
  }

  // A tick, or a checklist with no steps — whose stale page may still send
  // ticks, which mean nothing now and are ignored.
  const completed = input.completed === undefined ? (existing?.completed ?? false) : Boolean(input.completed)
  return { completed, value: null, note, steps: null }
}
