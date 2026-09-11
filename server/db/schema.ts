import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const habits = sqliteTable('habits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
  /** Set to hide a habit without losing its history. */
  archivedAt: text('archived_at'),
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
    completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  },
  t => [uniqueIndex('habit_entries_habit_date_idx').on(t.habitId, t.date)],
)

export type Habit = typeof habits.$inferSelect
export type HabitEntry = typeof habitEntries.$inferSelect
