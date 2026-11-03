import { asc } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { habits, habitSteps } from '../db/schema.js'
import { createTestDb } from '../test/pg-harness.js'
import { seedWorkRoutine, WORK_ROUTINE } from './work-routine.js'

type Db = Awaited<ReturnType<typeof createTestDb>>['db']

let db: Db
let close: () => Promise<void>

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
})

afterEach(async () => {
  await close()
})

describe('seedWorkRoutine', () => {
  it('adds the four morning habits as the spec lists them', async () => {
    await seedWorkRoutine(db, '2026-11-03')

    const rows = await db.select().from(habits).orderBy(asc(habits.id))
    expect(rows.map(row => [row.name, row.kind, row.slot, row.weekdays, row.timesPerWeek])).toEqual([
      ['Plan the week', 'checklist', 'morning', [1], 1],
      ['Check what each team member is working on', 'checklist', 'morning', [1, 2, 3, 4, 5], 5],
      ['Recap team initiatives', 'journal', 'morning', [1, 2, 3, 4, 5], 5],
      ['What did I do today', 'journal', 'morning', [1, 2, 3, 4, 5], 5],
    ])
    expect(rows.every(row => row.status === 'active' && row.activatedAt === '2026-11-03')).toBe(true)
    expect(rows.every(row => row.question)).toBe(true)
    expect(rows[0]!.notesEnabled).toBe(true)
  })

  it('gives Plan the week its five steps and a matching target (D-30)', async () => {
    await seedWorkRoutine(db, '2026-11-03')

    const steps = await db.select().from(habitSteps).orderBy(asc(habitSteps.position))
    expect(steps.map(step => step.label)).toEqual([
      'Check tasks in progress (team and mine)',
      'Check available tasks',
      'Check open PRs in catena-unicorn',
      'Order the tasks to tackle',
      'Decide the end-of-week target',
    ])
    const [plan] = await db.select().from(habits).orderBy(asc(habits.id))
    expect(plan!.target).toBe(5)
  })

  it('adds nothing twice when run again', async () => {
    await seedWorkRoutine(db, '2026-11-03')
    const second = await seedWorkRoutine(db, '2026-11-04')

    expect(second).toEqual([])
    expect(await db.select().from(habits)).toHaveLength(WORK_ROUTINE.length)
    expect(await db.select().from(habitSteps)).toHaveLength(5)
  })
})
