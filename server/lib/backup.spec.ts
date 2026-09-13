import { describe, expect, it } from 'vitest'
import type { Habit, HabitEntry } from '../db/schema.js'
import { BACKUP_FORMAT, BackupError, buildBackup, nextId, parseBackup } from './backup.js'

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 1,
    name: 'Exercise',
    kind: 'binary',
    unit: null,
    target: null,
    notesEnabled: true,
    status: 'active',
    activatedAt: '2026-09-01',
    position: 0,
    timesPerWeek: 4,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function entry(overrides: Partial<HabitEntry> = {}): HabitEntry {
  return { id: 1, habitId: 1, date: '2026-09-10', completed: true, value: null, note: null, ...overrides }
}

function backup(overrides: Record<string, unknown> = {}) {
  return {
    ...buildBackup({
      habits: [habit()],
      entries: [entry()],
      exportedAt: '2026-09-13T12:00:00.000Z',
      host: 'ep-test.neon.tech',
      schemaVersion: 3,
    }),
    ...overrides,
  }
}

describe('buildBackup', () => {
  it('carries both tables and the metadata that identifies the dump', () => {
    const result = backup()
    expect(result.format).toBe(BACKUP_FORMAT)
    expect(result.host).toBe('ep-test.neon.tech')
    expect(result.schemaVersion).toBe(3)
    expect(result.habits).toHaveLength(1)
    expect(result.entries).toHaveLength(1)
  })

  it('keeps ids, because entries reference habits by them', () => {
    const result = buildBackup({
      habits: [habit({ id: 7 })],
      entries: [entry({ id: 22, habitId: 7 })],
      exportedAt: 'x',
      host: 'y',
      schemaVersion: 1,
    })
    expect(result.habits[0]!.id).toBe(7)
    expect(result.entries[0]!.habitId).toBe(7)
  })
})

describe('parseBackup', () => {
  it('accepts a file it produced itself', () => {
    expect(() => parseBackup(JSON.parse(JSON.stringify(backup())))).not.toThrow()
  })

  it('rejects a file from a future format rather than guessing', () => {
    expect(() => parseBackup(backup({ format: 99 }))).toThrow(BackupError)
  })

  it('rejects an entry whose habit is missing, naming the entry', () => {
    // Restoring this would break the foreign key part way through and leave a
    // half-populated database — worse than refusing before touching anything.
    const broken = backup({ entries: [entry({ id: 22, habitId: 999, date: '2026-09-11' })] })
    expect(() => parseBackup(broken)).toThrow(/habit 999/)
    expect(() => parseBackup(broken)).toThrow(/2026-09-11/)
  })

  it('rejects a cadence outside 1-7, which the database would not have produced', () => {
    expect(() => parseBackup(backup({ habits: [habit({ timesPerWeek: 9 })] }))).toThrow(BackupError)
  })

  it('rejects an unknown habit status', () => {
    expect(() => parseBackup(backup({ habits: [{ ...habit(), status: 'paused' }] }))).toThrow(BackupError)
  })

  it('says where the problem is, not just that there is one', () => {
    // A restore happens when something has already gone wrong; "invalid input"
    // is not enough to act on.
    expect(() => parseBackup(backup({ habits: [{ ...habit(), name: 42 }] }))).toThrow(/habits\.0\.name/)
  })

  it('rejects something that is not a backup at all', () => {
    expect(() => parseBackup({ hello: 'world' })).toThrow(BackupError)
    expect(() => parseBackup(null)).toThrow(BackupError)
  })

  it('accepts an empty database', () => {
    const empty = backup({ habits: [], entries: [] })
    expect(parseBackup(empty).habits).toEqual([])
  })
})

describe('nextId', () => {
  it('is one past the highest id', () => {
    expect(nextId([{ id: 3 }, { id: 9 }, { id: 4 }])).toBe(10)
  })

  it('is 1 for an empty table, which is where a sequence starts', () => {
    expect(nextId([])).toBe(1)
  })
})
