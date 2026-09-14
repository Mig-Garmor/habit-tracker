import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { habitEntries, habits } from '../db/schema.js'
import { buildDashboard, dashboardRange } from '../lib/dashboard.js'
import { today } from '../lib/date.js'

export const dashboardRoutes = new Hono()

const DEFAULT_WEEKS = 15
const MAX_WEEKS = 53

dashboardRoutes.get('/', async c => {
  const requested = Number(c.req.query('weeks') ?? DEFAULT_WEEKS)
  const weeks = Number.isFinite(requested)
    ? Math.min(MAX_WEEKS, Math.max(1, Math.trunc(requested)))
    : DEFAULT_WEEKS

  const todayKey = today()
  // Both ends land on a week boundary so every column is a whole week, and the
  // range runs past today — today's square sits about two thirds across rather
  // than at the right edge, with the week ahead visible behind it.
  const { from, to } = dashboardRange(todayKey, weeks)

  const active = await db
    .select()
    .from(habits)
    .where(eq(habits.status, 'active'))
    .orderBy(asc(habits.position), asc(habits.id))

  // currentStreak has no depth cap, so a fetch window would truncate a long
  // streak (R10). buildDashboard's `days` still only spans dateRange(from, to),
  // and completionRate applies its own bounded window internally — only the
  // streak needs full history.
  const entries = await db.select().from(habitEntries)

  return c.json(buildDashboard(active, entries, from, todayKey, to))
})
