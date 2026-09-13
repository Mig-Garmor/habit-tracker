import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { habitEntries, habits, habitStatuses } from '../db/schema.js'
import { today } from '../lib/date.js'
import { createHabitSchema, quantityIsComplete, reorderHabitsSchema, updateHabitSchema } from '../validation.js'

export const habitsRoutes = new Hono()

habitsRoutes.get('/', async c => {
  const status = c.req.query('status')
  if (status && !habitStatuses.includes(status as (typeof habitStatuses)[number])) {
    return c.json({ error: `Unknown status: ${status}` }, 400)
  }

  const query = db.select().from(habits).$dynamic()
  const rows = await (status ? query.where(eq(habits.status, status as (typeof habitStatuses)[number])) : query)
    .orderBy(asc(habits.position), asc(habits.id))

  return c.json({ habits: rows })
})

habitsRoutes.post('/', zValidator('json', createHabitSchema), async c => {
  const input = c.req.valid('json')

  const [created] = await db
    .insert(habits)
    .values({
      ...input,
      // Only an active habit has started its grace period (D-3).
      activatedAt: input.status === 'active' ? today() : null,
    })
    .returning()

  return c.json({ habit: created }, 201)
})

/**
 * Registered before `/:id` routes so "reorder" is never read as an id.
 *
 * Takes the complete order for one status group. Everything is validated
 * before anything is written, so a rejected request leaves the stored order
 * exactly as it was.
 */
habitsRoutes.put('/reorder', zValidator('json', reorderHabitsSchema), async c => {
  const { ids } = c.req.valid('json')

  return db.transaction(async tx => {
    const rows = await tx.select().from(habits).where(inArray(habits.id, ids))

    if (rows.length !== ids.length) {
      return c.json({ error: 'Those habits do not all exist' }, 400)
    }

    const statuses = new Set(rows.map(row => row.status))
    if (statuses.size > 1) {
      return c.json({ error: 'Habits can only be reordered within one status group' }, 400)
    }

    // Reordering a partial group would leave the habits left out holding stale
    // positions, so the list silently rearranges again on the next load.
    const [status] = [...statuses]
    const group = await tx.select({ id: habits.id }).from(habits).where(eq(habits.status, status!))
    if (group.length !== ids.length) {
      return c.json({ error: 'Expected every habit in the group, in order' }, 400)
    }

    for (const [index, id] of ids.entries()) {
      await tx.update(habits).set({ position: index }).where(eq(habits.id, id))
    }

    return c.json({ ok: true })
  })
})

/**
 * Every note a habit carries, newest first.
 *
 * Separate from the dashboard because that only reaches back fifteen weeks,
 * and a note is worth keeping longer than the grid that happens to show it.
 * Days with no note are left out: a blank is not a note, and padding the list
 * with empties would make it useless for browsing, which is the whole point.
 */
habitsRoutes.get('/:id/notes', async c => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return c.json({ error: 'Invalid habit id' }, 400)
  }

  const [habit] = await db.select().from(habits).where(eq(habits.id, id))
  if (!habit) {
    return c.json({ error: 'Habit not found' }, 404)
  }

  const rows = await db
    .select({
      date: habitEntries.date,
      note: habitEntries.note,
      completed: habitEntries.completed,
      value: habitEntries.value,
    })
    .from(habitEntries)
    .where(and(
      eq(habitEntries.habitId, id),
      isNotNull(habitEntries.note),
      ne(habitEntries.note, ''),
    ))
    // Dates are text in YYYY-MM-DD, which sorts chronologically as text (D-8).
    .orderBy(desc(habitEntries.date))

  return c.json({
    habit: { id: habit.id, name: habit.name },
    notes: rows.map(row => ({ ...row, note: row.note ?? '' })),
  })
})

habitsRoutes.patch('/:id', zValidator('json', updateHabitSchema), async c => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return c.json({ error: 'Invalid habit id' }, 400)
  }

  const [existing] = await db.select().from(habits).where(eq(habits.id, id))
  if (!existing) {
    return c.json({ error: 'Habit not found' }, 404)
  }

  const input = c.req.valid('json')

  // Same invariant createHabitSchema enforces on create, checked against the
  // *merged* result — a patch touching only `name` must pass even though the
  // existing habit is a quantity habit, but a patch that would leave a
  // quantity habit without a unit or target must be rejected.
  const merged = { ...existing, ...input }
  if (!quantityIsComplete(merged)) {
    return c.json({ error: 'A quantity habit needs both a unit and a target' }, 400)
  }

  const becomingActive = input.status === 'active' && existing.status !== 'active'

  const [updated] = await db
    .update(habits)
    .set({
      ...input,
      // Returning to active restarts the grace period (D-3).
      ...(becomingActive ? { activatedAt: today() } : {}),
    })
    .where(eq(habits.id, id))
    .returning()

  return c.json({ habit: updated })
})
