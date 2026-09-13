import { asc, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { habitEntries, habits } from '../db/schema.js'
import { createTestDb } from '../test/pg-harness.js'
import { buildBackup, restoreBackup, type Backup } from './backup.js'

/**
 * The riskiest code in the feature: it deletes before it inserts, and it only
 * ever runs on the worst day. Exercised here against a real Postgres, because
 * the real database is the one holding the data and cannot be used as a test
 * subject.
 */

type Db = Awaited<ReturnType<typeof createTestDb>>['db']

let db: Db
let close: () => Promise<void>

const HABITS = [
  {
    id: 2, name: 'Exercise', kind: 'binary' as const, unit: null, target: null,
    notesEnabled: true, status: 'active' as const, activatedAt: '2026-09-01',
    position: 0, timesPerWeek: 4,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 8, name: 'Upload a video', kind: 'binary' as const, unit: null, target: null,
    notesEnabled: false, status: 'upcoming' as const, activatedAt: null,
    position: 1, timesPerWeek: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
]

const ENTRIES = [
  { id: 4, habitId: 2, date: '2026-09-10', completed: true, value: null, note: 'legs' },
]

function backupOf(habitRows: typeof HABITS, entryRows: typeof ENTRIES): Backup {
  return buildBackup({
    habits: habitRows,
    entries: entryRows,
    exportedAt: '2026-09-13T12:00:00.000Z',
    host: 'ep-test.neon.tech',
    schemaVersion: 3,
  })
}

beforeEach(async () => {
  const made = await createTestDb()
  db = made.db
  close = made.close
})

afterEach(async () => {
  await close()
})

describe('restoreBackup', () => {
  it('fills an empty database', async () => {
    await db.transaction(tx => restoreBackup(tx, backupOf(HABITS, ENTRIES)))

    expect((await db.select().from(habits).orderBy(asc(habits.id))).map(h => h.name))
      .toEqual(['Exercise', 'Upload a video'])
    expect(await db.select().from(habitEntries)).toHaveLength(1)
  })

  it('replaces what is already there rather than merging into it', async () => {
    await db.insert(habits).values([{
      id: 99, name: 'Something else', kind: 'binary', unit: null, target: null,
      notesEnabled: false, status: 'active', activatedAt: '2026-01-01',
      position: 0, timesPerWeek: 7,
    }])

    await db.transaction(tx => restoreBackup(tx, backupOf(HABITS, ENTRIES)))

    const names = (await db.select().from(habits)).map(h => h.name)
    // A merge would leave the old habit behind and silently mix two databases.
    expect(names).not.toContain('Something else')
    expect(names).toHaveLength(2)
  })

  it('moves the id sequence past the restored rows', async () => {
    await db.transaction(tx => restoreBackup(tx, backupOf(HABITS, ENTRIES)))

    // Without the sequence reset this insert collides with restored habit id 2,
    // and the failure surfaces long after the restore as a puzzling constraint
    // violation on an unrelated action.
    const [created] = await db.insert(habits).values({
      name: 'Created after the restore', kind: 'binary', unit: null, target: null,
      notesEnabled: false, status: 'active', activatedAt: '2026-09-13',
      position: 9, timesPerWeek: 7,
    }).returning()

    expect(created!.id).toBeGreaterThan(8)
  })

  it('moves the entry sequence too', async () => {
    await db.transaction(tx => restoreBackup(tx, backupOf(HABITS, ENTRIES)))

    const [created] = await db.insert(habitEntries).values({
      habitId: 2, date: '2026-09-12', completed: true, value: null, note: null,
    }).returning()

    expect(created!.id).toBeGreaterThan(4)
  })

  it('restores an empty backup without leaving the sequences unusable', async () => {
    await db.insert(habits).values([{
      id: 5, name: 'Gone', kind: 'binary', unit: null, target: null,
      notesEnabled: false, status: 'active', activatedAt: '2026-01-01',
      position: 0, timesPerWeek: 7,
    }])

    await db.transaction(tx => restoreBackup(tx, backupOf([], [])))

    expect(await db.select().from(habits)).toHaveLength(0)
    const [created] = await db.insert(habits).values({
      name: 'First again', kind: 'binary', unit: null, target: null,
      notesEnabled: false, status: 'active', activatedAt: '2026-09-13',
      position: 0, timesPerWeek: 7,
    }).returning()
    expect(created!.id).toBe(1)
  })

  it('leaves the database untouched when the restore fails part way', async () => {
    await db.insert(habits).values([{
      id: 42, name: 'Still here afterwards', kind: 'binary', unit: null, target: null,
      notesEnabled: false, status: 'active', activatedAt: '2026-01-01',
      position: 0, timesPerWeek: 7,
    }])

    // Two habits sharing an id: the second insert violates the primary key.
    const broken = backupOf([HABITS[0]!, { ...HABITS[1]!, id: HABITS[0]!.id }], [])
    await expect(db.transaction(tx => restoreBackup(tx, broken))).rejects.toThrow()

    // The delete must have rolled back with the failed insert. Otherwise a bad
    // dump destroys the data it was meant to replace.
    const rows = await db.select().from(habits)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('Still here afterwards')
  })

  it('keeps the sequences sane after a rollback', async () => {
    const before = await db.execute(sql`select last_value from habits_id_seq`)
    const broken = backupOf([HABITS[0]!, { ...HABITS[1]!, id: HABITS[0]!.id }], [])
    await expect(db.transaction(tx => restoreBackup(tx, broken))).rejects.toThrow()
    const after = await db.execute(sql`select last_value from habits_id_seq`)
    expect(after.rows[0]).toEqual(before.rows[0])
  })
})
