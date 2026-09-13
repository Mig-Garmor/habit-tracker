import { boolean, doublePrecision, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const habitKinds = ['binary', 'quantity'] as const
export const habitStatuses = ['active', 'upcoming', 'archived'] as const

export type HabitKind = (typeof habitKinds)[number]
export type HabitStatus = (typeof habitStatuses)[number]

export const habits = pgTable('habits', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  // Enum is enforced in TypeScript and by Zod at the edge, not by a Postgres
  // enum type — adding a status later should not need an ALTER TYPE (D-7).
  kind: text('kind', { enum: habitKinds }).notNull().default('binary'),
  /** Label for the logged amount, e.g. "minutes". Null for binary habits. */
  unit: text('unit'),
  /** Daily goal for quantity habits. Drives square shading (D-2). */
  target: doublePrecision('target'),
  notesEnabled: boolean('notes_enabled').notNull().default(false),
  status: text('status', { enum: habitStatuses }).notNull().default('active'),
  /**
   * Day the habit last entered `active` — starts the grace period (D-3).
   * Text, not a Postgres `date`: every day in this codebase is a local
   * calendar day written YYYY-MM-DD, and a driver returning Date objects
   * would silently break all of it (D-8).
   */
  activatedAt: text('activated_at'),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const habitEntries = pgTable(
  'habit_entries',
  {
    id: serial('id').primaryKey(),
    habitId: integer('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    /** Local calendar day, YYYY-MM-DD. One row per habit per day (D-8). */
    date: text('date').notNull(),
    /** Showed up at all. Derived from `value > 0` for quantity habits (D-1). */
    completed: boolean('completed').notNull().default(false),
    /** Minutes, reps, … for quantity habits. Null for binary. */
    value: doublePrecision('value'),
    note: text('note'),
  },
  t => [uniqueIndex('habit_entries_habit_date_idx').on(t.habitId, t.date)],
)

export type Habit = typeof habits.$inferSelect
export type HabitEntry = typeof habitEntries.$inferSelect
