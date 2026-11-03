import { zValidator } from '@hono/zod-validator'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { LogEntryError, saveEntries } from '../db/save-entries.js'
import { habitEntries, habits, type Habit } from '../db/schema.js'
import { stepsByHabit } from '../db/steps.js'
import { isValidDateKey, today } from '../lib/date.js'
import { logPayloadSchema } from '../validation.js'

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
  // By position, then id — the same order the habits list and the dashboard
  // use. Sorting by id alone meant a habit dragged to a new place kept its old
  // spot here, which is the one screen where the order matters most: it is the
  // list worked through every day.
  return [...byId.values()].sort((a, b) => a.position - b.position || a.id - b.id)
}

async function dayPayload(date: string) {
  const forDate = await habitsForDate(date)
  const entries = await db.select().from(habitEntries).where(eq(habitEntries.date, date))
  const byHabit = new Map(entries.map(entry => [entry.habitId, entry]))
  const steps = await stepsByHabit(forDate.map(habit => habit.id))

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
        slot: habit.slot,
        steps: (steps.get(habit.id) ?? []).map(step => ({ id: step.id, label: step.label })),
        entry: entry
          ? {
              completed: entry.completed,
              value: entry.value,
              note: entry.note,
              // Only a checklist has ticks to report; the others keep their old shape.
              ...(habit.kind === 'checklist' ? { steps: entry.steps } : {}),
            }
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

logRoutes.put('/:date', zValidator('json', logPayloadSchema), async c => {
  const date = c.req.param('date')
  if (!isValidDateKey(date)) return c.json({ error: 'Expected a date as YYYY-MM-DD' }, 400)
  if (date > today()) return c.json({ error: 'Cannot log a future day' }, 400)

  const { entries } = c.req.valid('json')

  try {
    await saveEntries(date, entries)
  } catch (err) {
    if (err instanceof LogEntryError) return c.json({ error: err.message }, err.status)
    throw err
  }

  return c.json(await dayPayload(date))
})
