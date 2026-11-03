import { and, eq } from 'drizzle-orm'
import { deriveEntry, EntryRuleError, type EntryInput } from '../lib/entry-rules.js'
import { db } from './client.js'
import { habitEntries, habits, habitSteps } from './schema.js'

/** Carries the HTTP status a mid-transaction validation failure should produce. */
export class LogEntryError extends Error {
  status: 404 | 400

  constructor(message: string, status: 404 | 400) {
    super(message)
    this.status = status
  }
}

/**
 * Writes one day's entries — the whole day is one commit: if a later entry is
 * invalid, earlier entries in the same call must not stick around half-saved.
 * Shared by `PUT /api/log/:date` and the MCP `log_habit` tool.
 */
export async function saveEntries(date: string, entries: (EntryInput & { habitId: number })[]): Promise<void> {
  await db.transaction(async tx => {
    for (const input of entries) {
      const [habit] = await tx.select().from(habits).where(eq(habits.id, input.habitId))
      if (!habit) throw new LogEntryError(`Habit ${input.habitId} not found`, 404)
      if (habit.status === 'archived') {
        throw new LogEntryError(`Habit ${input.habitId} is archived`, 400)
      }

      // An omitted note or set of ticks keeps whatever is stored (D-6), so
      // the stored row is read first.
      const [existing] = await tx
        .select()
        .from(habitEntries)
        .where(and(eq(habitEntries.habitId, habit.id), eq(habitEntries.date, date)))

      const stepIds = habit.kind === 'checklist'
        ? (await tx.select({ id: habitSteps.id }).from(habitSteps).where(eq(habitSteps.habitId, habit.id)))
            .map(row => row.id)
        : []

      // The server decides what counts as done — never the client (D-1).
      let derived
      try {
        derived = deriveEntry(habit, stepIds, input, existing ?? null)
      } catch (err) {
        if (err instanceof EntryRuleError) throw new LogEntryError(err.message, 400)
        throw err
      }
      const { completed, value, note, steps } = derived

      await tx
        .insert(habitEntries)
        .values({ habitId: habit.id, date, completed, value, note, steps })
        .onConflictDoUpdate({
          target: [habitEntries.habitId, habitEntries.date],
          set: { completed, value, note, steps },
        })
    }
  })
}
