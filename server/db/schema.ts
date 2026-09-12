import { sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const habitKinds = ['binary', 'quantity'] as const
export const habitStatuses = ['active', 'upcoming', 'archived'] as const

export type HabitKind = (typeof habitKinds)[number]
export type HabitStatus = (typeof habitStatuses)[number]

export const habits = sqliteTable('habits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  kind: text('kind', { enum: habitKinds }).notNull().default('binary'),
  /** Label for the logged amount, e.g. "minutes". Null for binary habits. */
  unit: text('unit'),
  /** Daily goal for quantity habits. Drives square shading (D-2). */
  target: real('target'),
  notesEnabled: integer('notes_enabled', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: habitStatuses }).notNull().default('active'),
  /** Day the habit last entered `active` — starts the grace period (D-3). */
  activatedAt: text('activated_at'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})

export const habitEntries = sqliteTable(
  'habit_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    habitId: integer('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    /** Local calendar day, YYYY-MM-DD. One row per habit per day. */
    date: text('date').notNull(),
    /** Showed up at all. Derived from `value > 0` for quantity habits (D-1). */
    completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
    /** Minutes, reps, … for quantity habits. Null for binary. */
    value: real('value'),
    note: text('note'),
  },
  t => [uniqueIndex('habit_entries_habit_date_idx').on(t.habitId, t.date)],
)

export type Habit = typeof habits.$inferSelect
export type HabitEntry = typeof habitEntries.$inferSelect
