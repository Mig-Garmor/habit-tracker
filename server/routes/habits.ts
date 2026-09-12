import { and, asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client'
import { habitEntries, habits } from '../db/schema'
import { today } from '../lib/date'

export const habitsRoutes = new Hono()

/** Today's active habits, each with its completion state for the day. */
habitsRoutes.get('/today', c => {
  const date = today()

  const rows = db
    .select({
      id: habits.id,
      name: habits.name,
      completed: habitEntries.completed,
    })
    .from(habits)
    .leftJoin(
      habitEntries,
      and(eq(habitEntries.habitId, habits.id), eq(habitEntries.date, date)),
    )
    .where(eq(habits.status, 'active'))
    .orderBy(asc(habits.id))
    .all()

  return c.json({
    date,
    habits: rows.map(row => ({ ...row, completed: row.completed ?? false })),
  })
})

/** Flip today's completion for one habit. Creates the day's row if absent. */
habitsRoutes.post('/:id/toggle', c => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return c.json({ error: 'Invalid habit id' }, 400)
  }

  const habit = db.select().from(habits).where(eq(habits.id, id)).get()
  if (!habit) {
    return c.json({ error: 'Habit not found' }, 404)
  }

  const date = today()
  const existing = db
    .select()
    .from(habitEntries)
    .where(and(eq(habitEntries.habitId, id), eq(habitEntries.date, date)))
    .get()

  const completed = !existing?.completed

  db.insert(habitEntries)
    .values({ habitId: id, date, completed })
    .onConflictDoUpdate({
      target: [habitEntries.habitId, habitEntries.date],
      set: { completed },
    })
    .run()

  return c.json({ id, date, completed })
})
