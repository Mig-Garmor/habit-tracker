import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { habitEntries, habits } from '../db/schema.js'
import { stepsByHabit } from '../db/steps.js'
import { isValidDateKey, startOfWeek, today } from '../lib/date.js'
import { buildToday, type TodayResponse } from '../lib/today.js'

export const todayRoutes = new Hono()

/** Both slots for one day, read fresh. Exported for the MCP server (part 2). */
export async function loadToday(date: string): Promise<TodayResponse> {
  const active = await db
    .select()
    .from(habits)
    .where(eq(habits.status, 'active'))
    .orderBy(asc(habits.position), asc(habits.id))

  // Only this week up to the day matters, to the day and to carry-over (D-31).
  const entries = await db
    .select()
    .from(habitEntries)
    .where(and(gte(habitEntries.date, startOfWeek(date)), lte(habitEntries.date, date)))

  return buildToday(active, await stepsByHabit(active.map(habit => habit.id)), entries, date)
}

todayRoutes.get('/:date', async c => {
  const date = c.req.param('date')
  if (!isValidDateKey(date)) return c.json({ error: 'Expected a date as YYYY-MM-DD' }, 400)
  if (date > today()) return c.json({ error: 'Cannot log a future day' }, 400)

  return c.json(await loadToday(date))
})
