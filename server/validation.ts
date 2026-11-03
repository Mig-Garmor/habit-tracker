import { z } from 'zod'
import { habitKinds, habitSlots, habitStatuses } from './db/schema.js'
import { isValidDateKey } from './lib/date.js'

export const dateKeySchema = z
  .string()
  .refine(isValidDateKey, 'Expected a real calendar date as YYYY-MM-DD')

const name = z.string().trim().min(1, 'Name is required').max(80)
const unit = z.string().trim().min(1).max(20).nullable()
const target = z.number().positive('Target must be greater than zero').nullable()
const timesPerWeek = z
  .number()
  .int('Cadence must be a whole number of times per week')
  .min(1, 'A habit must happen at least once a week')
  .max(7, 'A habit cannot happen more than once a day')

/** ISO weekdays, 1 = Monday (D-27). At least one, or the habit is never listed. */
const weekdays = z
  .array(z.number().int().min(1, 'Weekdays run 1 (Monday) to 7 (Sunday)').max(7, 'Weekdays run 1 (Monday) to 7 (Sunday)'))
  .min(1, 'Pick at least one day')
  .refine(days => new Set(days).size === days.length, 'The same day appears twice')
const slot = z.enum([...habitSlots])
const question = z.string().trim().max(200).nullable()

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
    timesPerWeek: timesPerWeek.default(7),
    slot: slot.default('evening'),
    weekdays: weekdays.default([1, 2, 3, 4, 5, 6, 7]),
    question: question.default(null),
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
  timesPerWeek: timesPerWeek.optional(),
  slot: slot.optional(),
  weekdays: weekdays.optional(),
  question: question.optional(),
})

export const logEntrySchema = z.object({
  habitId: z.number().int().positive(),
  completed: z.boolean().optional(),
  value: z.number().nonnegative().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  steps: z.array(z.number().int().positive()).max(20).optional(),
})

export const logPayloadSchema = z.object({
  entries: z.array(logEntrySchema).max(100),
})

/**
 * A reorder sends the WHOLE order for one status group, not a position delta.
 * Whole-list is idempotent and cannot drift: replaying it is a no-op, whereas
 * "move habit 4 to index 2" depends on what the client believed the list was.
 * The route additionally checks the ids are exactly one complete group.
 */
export const reorderHabitsSchema = z.object({
  ids: z
    .array(z.number().int().positive())
    .min(1, 'Expected at least one habit')
    .refine(ids => new Set(ids).size === ids.length, 'The same habit appears twice'),
})

/**
 * The complete, ordered step list for one checklist (D-35). An id renames and
 * moves an existing step; no id creates one; a step left out is deleted.
 */
export const stepsPayloadSchema = z.object({
  steps: z
    .array(z.object({
      id: z.number().int().positive().optional(),
      label: z.string().trim().min(1, 'A step needs a label').max(80),
    }))
    .max(20, 'A checklist can have at most 20 steps')
    .refine(
      steps => {
        const ids = steps.flatMap(step => (step.id === undefined ? [] : [step.id]))
        return new Set(ids).size === ids.length
      },
      'The same step appears twice',
    ),
})
