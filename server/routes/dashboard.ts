import { asc, eq, gte } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client'
import { habitEntries, habits } from '../db/schema'
import { WINDOW_DAYS } from '../lib/consistency'
import { buildDashboard } from '../lib/dashboard'
import { lastNDays, previousDay, startOfWeek, today } from '../lib/date'

export const dashboardRoutes = new Hono()

const DEFAULT_WEEKS = 15
const MAX_WEEKS = 53

dashboardRoutes.get('/', c => {
  const requested = Number(c.req.query('weeks') ?? DEFAULT_WEEKS)
  const weeks = Number.isFinite(requested)
    ? Math.min(MAX_WEEKS, Math.max(1, Math.trunc(requested)))
    : DEFAULT_WEEKS

  const todayKey = today()
  let from = todayKey
  for (let i = 0; i < weeks * 7; i++) from = previousDay(from)
  // Grids start on a week boundary so columns are whole weeks.
  from = startOfWeek(from)

  const active = db
    .select()
    .from(habits)
    .where(eq(habits.status, 'active'))
    .orderBy(asc(habits.id))
    .all()

  // Health and rate need the full consistency window even when the grid is
  // short, so never fetch less than WINDOW_DAYS of entries.
  const windowStart = lastNDays(WINDOW_DAYS, todayKey)[0]!
  const entriesFrom = from < windowStart ? from : windowStart

  const entries = db.select().from(habitEntries).where(gte(habitEntries.date, entriesFrom)).all()

  return c.json(buildDashboard(active, entries, from, todayKey))
})
