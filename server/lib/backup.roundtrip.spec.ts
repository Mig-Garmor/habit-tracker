import { asc } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { habitEntries, habits } from '../db/schema.js'
import { createTestDb } from '../test/pg-harness.js'
import { buildBackup, parseBackup } from './backup.js'

/**
 * The property that actually matters: data put into a backup comes back out of
 * it unchanged, through a real database at both ends and through JSON in the
 * middle.
 *
 * Validating the file's shape is not the same thing. A dump can be perfectly
 * well-formed and still lose a null, coerce a number to a string, or drop the
 * link between an entry and its habit — and none of that is discoverable until
 * the day it is restored, which is the day it must not fail.
 */

type Db = Awaited<ReturnType<typeof createTestDb>>['db']

let source: Db
let target: Db
let closeSource: () => Promise<void>
let closeTarget: () => Promise<void>

const HABITS = [
  {
    id: 1, name: 'Exercise', kind: 'binary' as const, unit: null, target: null,
    notesEnabled: true, status: 'active' as const, activatedAt: '2026-09-01',
    position: 0, timesPerWeek: 4,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 5, name: 'Meditation', kind: 'quantity' as const, unit: 'minutes', target: 10,
    notesEnabled: false, status: 'active' as const, activatedAt: '2026-08-15',
    position: 1, timesPerWeek: 7,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    // Non-contiguous id and a parked status: a restore must not quietly
    // renumber or normalise anything.
    id: 12, name: 'Upload a video', kind: 'binary' as const, unit: null, target: null,
    notesEnabled: false, status: 'upcoming' as const, activatedAt: null,
    position: 2, timesPerWeek: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
]

const ENTRIES = [
  { id: 3, habitId: 1, date: '2026-09-10', completed: true, value: null, note: 'legs, 40 minutes' },
  { id: 4, habitId: 5, date: '2026-09-10', completed: true, value: 12.5, note: null },
  // A logged-but-not-done day: `completed: false` must survive, since it means
  // something different from no row at all.
  { id: 9, habitId: 1, date: '2026-09-11', completed: false, value: null, note: null },
]

beforeAll(async () => {
  const a = await createTestDb()
  source = a.db
  closeSource = a.close
  const b = await createTestDb()
  target = b.db
  closeTarget = b.close

  await source.insert(habits).values(HABITS)
  await source.insert(habitEntries).values(ENTRIES)
})

afterAll(async () => {
  await closeSource()
  await closeTarget()
})

describe('a backup round trip', () => {
  it('restores every habit and entry byte for byte', async () => {
    const habitRows = await source.select().from(habits).orderBy(asc(habits.id))
    const entryRows = await source.select().from(habitEntries).orderBy(asc(habitEntries.id))

    const backup = buildBackup({
      habits: habitRows,
      entries: entryRows,
      exportedAt: '2026-09-13T12:00:00.000Z',
      host: 'ep-test.neon.tech',
      schemaVersion: 3,
    })

    // Through JSON, exactly as the file would be written and read back.
    const restored = parseBackup(JSON.parse(JSON.stringify(backup)))

    await target.insert(habits).values(restored.habits)
    await target.insert(habitEntries).values(restored.entries)

    expect(await target.select().from(habits).orderBy(asc(habits.id))).toEqual(habitRows)
    expect(await target.select().from(habitEntries).orderBy(asc(habitEntries.id))).toEqual(entryRows)
  })

  it('keeps entries pointing at the same habits', async () => {
    const rows = await target.select().from(habitEntries).orderBy(asc(habitEntries.id))
    // Ids are not bookkeeping here: renumber them and the tables stop relating.
    expect(rows.map(row => [row.id, row.habitId])).toEqual([[3, 1], [4, 5], [9, 1]])
  })

  it('keeps a null apart from a zero, and a note apart from an empty one', async () => {
    const rows = await target.select().from(habitEntries).orderBy(asc(habitEntries.id))
    expect(rows[0]!.value).toBeNull()
    expect(rows[1]!.value).toBe(12.5)
    expect(rows[0]!.note).toBe('legs, 40 minutes')
    expect(rows[2]!.note).toBeNull()
  })

  it('keeps a logged-but-not-done day, which differs from no row at all', async () => {
    const rows = await target.select().from(habitEntries).orderBy(asc(habitEntries.id))
    expect(rows[2]!.completed).toBe(false)
  })
})
