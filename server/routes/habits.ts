import { zValidator } from '@hono/zod-validator'
import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client'
import { habits, habitStatuses } from '../db/schema'
import { today } from '../lib/date'
import { createHabitSchema, updateHabitSchema } from '../validation'

export const habitsRoutes = new Hono()

habitsRoutes.get('/', c => {
  const status = c.req.query('status')
  if (status && !habitStatuses.includes(status as (typeof habitStatuses)[number])) {
    return c.json({ error: `Unknown status: ${status}` }, 400)
  }

  const query = db.select().from(habits).$dynamic()
  const rows = (status ? query.where(eq(habits.status, status as (typeof habitStatuses)[number])) : query)
    .orderBy(asc(habits.id))
    .all()

  return c.json({ habits: rows })
})

habitsRoutes.post('/', zValidator('json', createHabitSchema), c => {
  const input = c.req.valid('json')

  const created = db
    .insert(habits)
    .values({
      ...input,
      // Only an active habit has started its grace period (D-3).
      activatedAt: input.status === 'active' ? today() : null,
    })
    .returning()
    .get()

  return c.json({ habit: created }, 201)
})

habitsRoutes.patch('/:id', zValidator('json', updateHabitSchema), c => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return c.json({ error: 'Invalid habit id' }, 400)
  }

  const existing = db.select().from(habits).where(eq(habits.id, id)).get()
  if (!existing) {
    return c.json({ error: 'Habit not found' }, 404)
  }

  const input = c.req.valid('json')
  const becomingActive = input.status === 'active' && existing.status !== 'active'

  const updated = db
    .update(habits)
    .set({
      ...input,
      // Returning to active restarts the grace period (D-3).
      ...(becomingActive ? { activatedAt: today() } : {}),
    })
    .where(eq(habits.id, id))
    .returning()
    .get()

  return c.json({ habit: updated })
})
