import { sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { habitEntries, habitKinds, habits, habitStatuses, type Habit, type HabitEntry } from '../db/schema.js'

/**
 * Only what a restore actually needs from a transaction.
 *
 * Structural rather than tied to the Neon client, so the same function runs
 * against pglite in tests. Binding it to the production driver's type would
 * mean the riskiest code here could only ever be exercised against the one
 * database that must not be used as a test subject.
 */
interface RestoreTx {
  delete(table: typeof habits | typeof habitEntries): PromiseLike<unknown>
  insert(table: typeof habits): { values(rows: Backup['habits']): PromiseLike<unknown> }
  insert(table: typeof habitEntries): { values(rows: Backup['entries']): PromiseLike<unknown> }
  execute(query: SQL): PromiseLike<unknown>
}

/**
 * The shape of a backup file, and the only place that shape is defined.
 *
 * Exporting and importing are separate scripts run months or years apart —
 * plausibly with a schema change between them — so the file is validated on
 * the way in rather than trusted. A restore is attempted exactly when
 * something has already gone wrong; discovering then that the dump is
 * unreadable is the worst possible moment.
 *
 * Ids are preserved deliberately. Entries reference habits by id, so ids are
 * not incidental bookkeeping — drop them and the two tables no longer relate.
 */

export const BACKUP_FORMAT = 1

const habitSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  kind: z.enum([...habitKinds]),
  unit: z.string().nullable(),
  target: z.number().nullable(),
  notesEnabled: z.boolean(),
  status: z.enum([...habitStatuses]),
  activatedAt: z.string().nullable(),
  position: z.number().int(),
  timesPerWeek: z.number().int().min(1).max(7),
  createdAt: z.string(),
})

const entrySchema = z.object({
  id: z.number().int().positive(),
  habitId: z.number().int().positive(),
  date: z.string(),
  completed: z.boolean(),
  value: z.number().nullable(),
  note: z.string().nullable(),
})

export const backupSchema = z.object({
  /** Bumped only when the file layout changes incompatibly. */
  format: z.literal(BACKUP_FORMAT),
  exportedAt: z.string(),
  /**
   * Host only, never the connection string. Present so a dump can be told
   * apart from another environment's at a glance — which matters while one
   * Neon branch serves both development and production.
   */
  host: z.string(),
  /** Applied migration count when the dump was taken. */
  schemaVersion: z.number().int().nonnegative(),
  habits: z.array(habitSchema),
  entries: z.array(entrySchema),
})

export type Backup = z.infer<typeof backupSchema>

export function buildBackup(input: {
  habits: Habit[]
  entries: HabitEntry[]
  exportedAt: string
  host: string
  schemaVersion: number
}): Backup {
  return {
    format: BACKUP_FORMAT,
    exportedAt: input.exportedAt,
    host: input.host,
    schemaVersion: input.schemaVersion,
    habits: input.habits,
    entries: input.entries,
  }
}

export class BackupError extends Error {}

/**
 * Validates a parsed backup. Throws `BackupError` with something a person can
 * act on — a restore is run under pressure, and "invalid input" is not enough
 * to work out what to do next.
 */
export function parseBackup(value: unknown): Backup {
  const result = backupSchema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue?.path.length ? issue.path.join('.') : 'the file'
    throw new BackupError(`Not a valid backup: ${issue?.message ?? 'unknown problem'} (at ${where})`)
  }

  const backup = result.data
  const habitIds = new Set(backup.habits.map(habit => habit.id))
  const orphan = backup.entries.find(entry => !habitIds.has(entry.habitId))
  if (orphan) {
    // Restoring this would violate the foreign key half way through and leave
    // a partly-populated database, which is worse than refusing up front.
    throw new BackupError(
      `Entry ${orphan.id} on ${orphan.date} refers to habit ${orphan.habitId}, which is not in the file.`,
    )
  }

  return backup
}

/** The next free id, for resetting a sequence after a restore. */
export function nextId(rows: { id: number }[]): number {
  return rows.reduce((highest, row) => Math.max(highest, row.id), 0) + 1
}

/**
 * Writes a backup into a database, replacing whatever is there.
 *
 * Lives here rather than in the script so it can be tested. It is the riskiest
 * code in the feature — it deletes before it inserts — and it only ever runs
 * on the worst day, when nobody is in a position to debug it. Testing it
 * against the real database is not an option, because the only real database
 * is the one holding the data.
 *
 * The caller decides whether replacing is allowed and supplies the
 * transaction; this just does the work inside it, so a failure anywhere leaves
 * the database exactly as it was.
 */
export async function restoreBackup(tx: RestoreTx, backup: Backup): Promise<void> {
  // Entries first even though the foreign key cascades: being explicit costs
  // nothing and does not depend on the cascade staying in place.
  await tx.delete(habitEntries)
  await tx.delete(habits)

  if (backup.habits.length > 0) await tx.insert(habits).values(backup.habits)
  if (backup.entries.length > 0) await tx.insert(habitEntries).values(backup.entries)

  // Ids were inserted explicitly, so the sequences still sit where they were.
  // Without this the next habit created collides with a restored one — which
  // surfaces long after the restore, as a confusing constraint violation.
  await tx.execute(sql`select setval('habits_id_seq', ${nextId(backup.habits)}, false)`)
  await tx.execute(sql`select setval('habit_entries_id_seq', ${nextId(backup.entries)}, false)`)
}
