import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../test/pg-harness.js'

const holder = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock('../db/client', () => ({
  get db() {
    return holder.db
  },
}))

type Db = Awaited<ReturnType<typeof createTestDb>>['db']
type Result = { content: { text: string }[], structuredContent?: any, isError?: boolean }

let closeTestDb: () => Promise<void>
let call: (name: string, args?: Record<string, unknown>) => Promise<Result>
let list: () => { name: string }[]

// The week of Monday 2026-10-26.
const MON = '2026-10-26'
const TUE = '2026-10-27'
const WED = '2026-10-28'

beforeAll(async () => {
  const { db, close } = await createTestDb()
  holder.db = db
  closeTestDb = close

  const { seedWorkRoutine, TEAM_CHECK } = await import('../lib/work-routine.js')
  const { habits, habitSteps } = await import('../db/schema.js')
  await seedWorkRoutine(db as never, '2026-10-01')
  await (db as Db).insert(habits).values({ name: 'Exercise', status: 'active', activatedAt: '2026-10-01', notesEnabled: true })
  const [team] = await (db as Db).select().from(habits).where(eq(habits.name, TEAM_CHECK))
  await (db as Db).insert(habitSteps).values(['Wil', 'Daren', 'Ismael'].map((label, position) => ({ habitId: team!.id, label, position })))

  const { saveEntries } = await import('../db/save-entries.js')
  const id = async (name: string) => (await (db as Db).select().from(habits).where(eq(habits.name, name)))[0]!.id
  await saveEntries(MON, [{ habitId: await id('Recap team initiatives'), note: 'Hydra: Payload v4 merged' }])
  await saveEntries(TUE, [
    { habitId: await id('Recap team initiatives'), note: 'Hydra: permissions in review' },
    { habitId: await id('Exercise'), completed: true, note: '5k' },
  ])
  // Plan the week happens on Wednesday this time, which still counts (D-27).
  await saveEntries(WED, [{ habitId: await id('Plan the week'), note: 'Ship the Today view' }])

  const { habitTools } = await import('./tools.js')
  call = (name, args = {}) => habitTools.call(name, args) as Promise<Result>
  list = habitTools.list
})

afterAll(async () => {
  await closeTestDb()
})

describe('the read tools', () => {
  it('are all listed', () => {
    expect(list().map(tool => tool.name)).toEqual(expect.arrayContaining([
      'get_today', 'list_questions', 'get_daily_report', 'get_week_objectives',
      'get_team_initiatives', 'get_team', 'get_habit_notes',
    ]))
  })

  it('get_today returns both slots, carrying an unplanned Monday', async () => {
    const { structuredContent } = await call('get_today', { date: TUE })
    const morning = structuredContent.slots.morning.habits
    expect(morning.find((h: any) => h.name === 'Plan the week').carriedFrom).toBe(MON)
    expect(structuredContent.slots.evening.habits.map((h: any) => h.name)).toEqual(['Exercise'])
    expect(structuredContent.front).toBeNull()
  })

  it('refuses a future or malformed date as a tool error, not a crash', async () => {
    expect((await call('get_today', { date: '2999-01-01' })).isError).toBe(true)
    expect((await call('get_today', { date: '27/10/2026' })).isError).toBe(true)
  })

  it('list_questions gives each listed habit’s question', async () => {
    const { structuredContent } = await call('list_questions', { date: TUE })
    expect(structuredContent.questions).toContainEqual({
      habit: 'Check what each team member is working on', slot: 'morning',
      question: 'Is anyone blocked, or carrying more than two COS tickets?', done: false,
    })
  })

  it('get_week_objectives reads this week’s plan', async () => {
    const { structuredContent } = await call('get_week_objectives', { date: WED })
    expect(structuredContent.objectives).toEqual({ date: WED, note: 'Ship the Today view', stale: false })
  })

  it('falls back to last week’s plan and says so', async () => {
    const { structuredContent } = await call('get_week_objectives', { date: '2026-11-02' })
    expect(structuredContent.objectives).toEqual({ date: WED, note: 'Ship the Today view', stale: true })
  })

  it('has nothing before any plan was written', async () => {
    const result = await call('get_week_objectives', { date: '2026-10-20' })
    expect(result.structuredContent.objectives).toBeNull()
    expect(result.content[0]!.text).toContain('None written yet')
  })

  it('get_team_initiatives lists recaps newest first', async () => {
    const { structuredContent } = await call('get_team_initiatives', { limit: 1 })
    expect(structuredContent.notes).toEqual([{ date: TUE, note: 'Hydra: permissions in review' }])
  })

  it('get_team reads the names off the team checklist', async () => {
    expect((await call('get_team')).structuredContent.team).toEqual(['Wil', 'Daren', 'Ismael'])
  })

  it('get_habit_notes finds a habit whatever its case (D-41)', async () => {
    expect((await call('get_habit_notes', { habit: 'exercise' })).structuredContent.notes).toEqual([{ date: TUE, note: '5k' }])
  })

  it('names the habits it knows when asked for one it does not', async () => {
    const result = await call('get_habit_notes', { habit: 'Swimming' })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('No habit called "Swimming"')
    expect(result.content[0]!.text).toContain('Exercise')
  })

  it('get_daily_report renders the fixed report', async () => {
    const { content } = await call('get_daily_report', { date: TUE })
    expect(content[0]!.text).toMatch(/^# Daily report — Tuesday 2026-10-27/)
    expect(content[0]!.text).toContain('- [x] Exercise — done')
  })
})

describe('log_habit', () => {
  const FRI = '2026-10-30'

  beforeAll(async () => {
    const { habits } = await import('../db/schema.js')
    await (holder.db as Db).insert(habits).values({ name: 'Reading', kind: 'quantity', unit: 'pages', target: 20, status: 'active', activatedAt: '2026-10-01' })
  })

  it('is listed', () => {
    expect(list().map(tool => tool.name)).toContain('log_habit')
  })

  it('ticks a habit', async () => {
    const { structuredContent } = await call('log_habit', { habit: 'Exercise', date: FRI, completed: true })
    expect(structuredContent).toMatchObject({ habit: 'Exercise', date: FRI, entry: { completed: true } })
  })

  it('keeps the tick when only a note is added afterwards', async () => {
    const { structuredContent } = await call('log_habit', { habit: 'Exercise', date: FRI, note: 'intervals' })
    expect(structuredContent.entry).toMatchObject({ completed: true, note: 'intervals' })
  })

  it('records an amount', async () => {
    const { structuredContent } = await call('log_habit', { habit: 'reading', date: FRI, value: 12 })
    expect(structuredContent.entry).toMatchObject({ completed: true, value: 12 })
  })

  it('completes a journal by writing in it (D-32)', async () => {
    const { structuredContent } = await call('log_habit', { habit: 'What did I do today', date: FRI, note: 'Shipped the Today view' })
    expect(structuredContent.entry).toMatchObject({ completed: true, note: 'Shipped the Today view' })
  })

  it('ticks checklist steps by their labels, in any case', async () => {
    const { structuredContent } = await call('log_habit', { habit: 'Plan the week', date: FRI, steps: ['check open prs in catena-unicorn'] })
    expect(structuredContent.entry).toMatchObject({ completed: true, value: 1, steps: ['Check open PRs in catena-unicorn'] })
  })

  it('names the real steps when given one that does not exist', async () => {
    const result = await call('log_habit', { habit: 'Plan the week', date: FRI, steps: ['Make coffee'] })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toBe('"Plan the week" has no step "Make coffee". Its steps: "Check tasks in progress (team and mine)", '
      + '"Check available tasks", "Check open PRs in catena-unicorn", "Order the tasks to tackle", "Decide the end-of-week target".')
  })

  it('refuses a future day', async () => {
    expect((await call('log_habit', { habit: 'Exercise', date: '2999-01-01', completed: true })).isError).toBe(true)
  })

  it('refuses a call that says nothing to record', async () => {
    const result = await call('log_habit', { habit: 'Exercise', date: FRI })
    expect(result.isError).toBe(true)
  })
})
