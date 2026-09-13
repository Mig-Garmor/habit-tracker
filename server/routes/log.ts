import { zValidator } from '@hono/zod-validator'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client'
import { habitEntries, habits, type Habit } from '../db/schema'
import { isValidDateKey, today } from '../lib/date'
import { logPayloadSchema } from '../validation'

export const logRoutes = new Hono()

/**
 * Habits loggable on a given day: everything currently active, plus any
 * non-archived habit that already has an entry that day, so a demoted habit's
 * past days stay editable (D-5).
 */
async function habitsForDate(date: string): Promise<Habit[]> {
  const active = await db.select().from(habits).where(eq(habits.status, 'active'))

  const logged = await db
    .select({ habitId: habitEntries.habitId })
    .from(habitEntries)
    .where(eq(habitEntries.date, date))

  const loggedIds = logged.map(row => row.habitId)

  const extras = loggedIds.length
    ? await db
        .select()
        .from(habits)
        .where(and(inArray(habits.id, loggedIds), ne(habits.status, 'archived')))
    : []

  const byId = new Map<number, Habit>()
  for (const habit of [...active, ...extras]) byId.set(habit.id, habit)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

async function dayPayload(date: string) {
  const forDate = await habitsForDate(date)
  const entries = await db.select().from(habitEntries).where(eq(habitEntries.date, date))
  const byHabit = new Map(entries.map(entry => [entry.habitId, entry]))

  return {
    date,
    isToday: date === today(),
    habits: forDate.map(habit => {
      const entry = byHabit.get(habit.id)
      return {
        id: habit.id,
        name: habit.name,
        kind: habit.kind,
        unit: habit.unit,
        target: habit.target,
        notesEnabled: habit.notesEnabled,
        entry: entry
          ? { completed: entry.completed, value: entry.value, note: entry.note }
          : null,
      }
    }),
  }
}

logRoutes.get('/:date', async c => {
  const date = c.req.param('date')
  if (!isValidDateKey(date)) return c.json({ error: 'Expected a date as YYYY-MM-DD' }, 400)
  if (date > today()) return c.json({ error: 'Cannot log a future day' }, 400)

  return c.json(await dayPayload(date))
})

/** Carries the HTTP status a mid-transaction validation failure should produce. */
class LogEntryError extends Error {
  status: 404 | 400

  constructor(message: string, status: 404 | 400) {
    super(message)
    this.status = status
  }
}

logRoutes.put('/:date', zValidator('json', logPayloadSchema), async c => {
  const date = c.req.param('date')
  if (!isValidDateKey(date)) return c.json({ error: 'Expected a date as YYYY-MM-DD' }, 400)
  if (date > today()) return c.json({ error: 'Cannot log a future day' }, 400)

  const { entries } = c.req.valid('json')

  // The whole day is one commit: if a later entry is invalid, earlier entries
  // in this same PUT must not stick around half-saved.
  try {
    await db.transaction(async tx => {
      for (const input of entries) {
        const [habit] = await tx.select().from(habits).where(eq(habits.id, input.habitId))
        if (!habit) throw new LogEntryError(`Habit ${input.habitId} not found`, 404)
        if (habit.status === 'archived') {
          throw new LogEntryError(`Habit ${input.habitId} is archived`, 400)
        }

        const isQuantity = habit.kind === 'quantity'
        const value = isQuantity ? (input.value ?? 0) : null
        // The server decides what counts as done — never the client (D-1).
        const completed = isQuantity ? value! > 0 : Boolean(input.completed)

        // An omitted note keeps whatever is stored, so turning notesEnabled off
        // never destroys existing notes (D-6). Only an explicit note replaces one.
        const [existing] = await tx
          .select()
          .from(habitEntries)
          .where(and(eq(habitEntries.habitId, habit.id), eq(habitEntries.date, date)))

        const note =
          input.note === undefined
            ? (existing?.note ?? null)
            : (input.note?.trim() ? input.note.trim() : null)

        await tx
          .insert(habitEntries)
          .values({ habitId: habit.id, date, completed, value, note })
          .onConflictDoUpdate({
            target: [habitEntries.habitId, habitEntries.date],
            set: { completed, value, note },
          })
      }
    })
  } catch (err) {
    if (err instanceof LogEntryError) return c.json({ error: err.message }, err.status)
    throw err
  }

  return c.json(await dayPayload(date))
})
