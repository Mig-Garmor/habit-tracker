import { z } from 'zod'
import { habitKinds, habitStatuses } from './db/schema.js'
import { isValidDateKey } from './lib/date.js'

export const dateKeySchema = z
  .string()
  .refine(isValidDateKey, 'Expected a real calendar date as YYYY-MM-DD')

const name = z.string().trim().min(1, 'Name is required').max(80)
const unit = z.string().trim().min(1).max(20).nullable()
const target = z.number().positive('Target must be greater than zero').nullable()

/**
 * A quantity habit is meaningless without something to count and a goal to
 * count against. Exported so the PATCH route can re-check it against the
 * *merged* (existing + patch) habit — a partial update must not produce a
 * quantity habit missing either field, even though no single field of the
 * patch is invalid on its own.
 */
export function quantityIsComplete(habit: { kind: string, unit: unknown, target: unknown }) {
  return habit.kind !== 'quantity' || (habit.unit !== null && habit.target !== null)
}

export const createHabitSchema = z
  .object({
    name,
    kind: z.enum([...habitKinds]).default('binary'),
    unit: unit.default(null),
    target: target.default(null),
    notesEnabled: z.boolean().default(false),
    // A habit is never created already archived.
    status: z.enum(['active', 'upcoming']).default('active'),
  })
  .refine(quantityIsComplete, {
    message: 'A quantity habit needs both a unit and a target',
    path: ['target'],
  })

export const updateHabitSchema = z.object({
  name: name.optional(),
  kind: z.enum([...habitKinds]).optional(),
  unit: unit.optional(),
  target: target.optional(),
  notesEnabled: z.boolean().optional(),
  status: z.enum([...habitStatuses]).optional(),
})

export const logEntrySchema = z.object({
  habitId: z.number().int().positive(),
  completed: z.boolean().optional(),
  value: z.number().nonnegative().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
})

export const logPayloadSchema = z.object({
  entries: z.array(logEntrySchema).max(100),
})
