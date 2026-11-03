import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../test/pg-harness.js'
import { signedCookieHeader, TEST_EMAIL, TEST_SESSION_SECRET } from '../test/session-cookie.js'

const holder = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock('../db/client', () => ({
  get db() {
    return holder.db
  },
  isDatabaseConfigured: () => true,
  databaseStatus: () => Promise.resolve('reachable'),
}))

interface TodayHabit {
  id: number
  name: string
  kind: string
  question: string | null
  steps: { id: number, label: string }[]
  carriedFrom: string | null
  progress: number
  entry: { completed: boolean, value: number | null, note: string | null, steps?: number[] | null } | null
}

interface TodaySlot {
  habits: TodayHabit[]
  progress: number
  done: number
  total: number
}

interface TodayResponse {
  date: string
  weekday: number
  morningVisible: boolean
  slots: { morning: TodaySlot, evening: TodaySlot }
}

// Two past weeks: 2026-10-19 and 2026-10-26, both Monday to Sunday.
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }
let closeTestDb: () => Promise<void>
let cookie: string
let planId: number
let recapId: number
let stepIds: number[]

async function readJson<T>(response: Response | Promise<Response>): Promise<T> {
  return (await (await response).json()) as T
}

function send(method: string, path: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

async function create(body: unknown): Promise<number> {
  return (await readJson<{ habit: { id: number } }>(send('POST', '/api/habits', body))).habit.id
}

const today = (date: string) => readJson<TodayResponse>(app.request(`/api/today/${date}`, { headers: { cookie } }))
const names = (slot: TodaySlot) => slot.habits.map(habit => habit.name)

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SESSION_SECRET
  process.env.ALLOWED_EMAILS = TEST_EMAIL
  cookie = await signedCookieHeader()

  const { db, close } = await createTestDb()
  holder.db = db
  closeTestDb = close
  app = (await import('../app.js')).createApp()

  planId = await create({
    name: 'Plan the week', kind: 'checklist', slot: 'morning', weekdays: [1], timesPerWeek: 1,
    notesEnabled: true, question: 'What has to be finished by Friday?',
  })
  await create({ name: 'Check the team', kind: 'checklist', slot: 'morning', weekdays: [1, 2, 3, 4, 5], timesPerWeek: 5 })
  recapId = await create({ name: 'Recap team initiatives', kind: 'journal', slot: 'morning', weekdays: [1, 2, 3, 4, 5], timesPerWeek: 5 })
  await create({ name: 'Exercise', timesPerWeek: 4 })
  await create({ name: 'Someday', status: 'upcoming' })

  const steps = await readJson<{ habit: { steps: { id: number }[] } }>(send('PUT', `/api/habits/${planId}/steps`, {
    steps: ['Tasks in progress', 'Available tasks', 'Open PRs', 'Order', 'Target'].map(label => ({ label })),
  }))
  stepIds = steps.habit.steps.map(step => step.id)
})

afterAll(async () => {
  await closeTestDb()
})

describe('GET /api/today/:date', () => {
  it('lists each habit in its own slot on a Monday', async () => {
    const body = await today('2026-10-26')
    expect(body).toMatchObject({ date: '2026-10-26', weekday: 1, morningVisible: true })
    expect(names(body.slots.morning)).toEqual(['Plan the week', 'Check the team', 'Recap team initiatives'])
    expect(names(body.slots.evening)).toEqual(['Exercise'])
  })

  it('carries the question and the steps', async () => {
    const plan = (await today('2026-10-26')).slots.morning.habits[0]!
    expect(plan.question).toBe('What has to be finished by Friday?')
    expect(plan.steps.map(step => step.label)).toEqual(['Tasks in progress', 'Available tasks', 'Open PRs', 'Order', 'Target'])
    expect(plan.carriedFrom).toBeNull()
  })

  it('carries an unplanned Monday into Tuesday, saying where it came from (D-31)', async () => {
    const plan = (await today('2026-10-27')).slots.morning.habits.find(h => h.id === planId)
    expect(plan?.carriedFrom).toBe('2026-10-26')
  })

  it('stops carrying it once the week was planned on Monday', async () => {
    await send('PUT', '/api/log/2026-10-19', { entries: [{ habitId: planId, steps: [stepIds[0]] }] })
    expect(names((await today('2026-10-20')).slots.morning)).not.toContain('Plan the week')
  })

  it('has no morning at the weekend, not even what is carried (D-29)', async () => {
    const body = await today('2026-10-31')
    expect(body.morningVisible).toBe(false)
    expect(body.slots.morning).toEqual({ habits: [], progress: 0, done: 0, total: 0 })
    expect(names(body.slots.evening)).toEqual(['Exercise'])
  })

  it('reports how far through the slot the day is (D-33)', async () => {
    await send('PUT', '/api/log/2026-10-26', {
      entries: [
        { habitId: planId, steps: [stepIds[0], stepIds[1]] },
        { habitId: recapId, note: 'Hydra: Payload v4 merged' },
      ],
    })
    const body = await today('2026-10-26')
    const plan = body.slots.morning.habits.find(h => h.id === planId)!
    expect(plan.progress).toBeCloseTo(0.4)
    expect(plan.entry).toMatchObject({ completed: true, value: 2, steps: [stepIds[0], stepIds[1]] })
    // (0.4 + 0 + 1) / 3
    expect(body.slots.morning.progress).toBeCloseTo(1.4 / 3)
    expect(body.slots.morning).toMatchObject({ done: 2, total: 3 })
    expect(body.slots.evening).toMatchObject({ progress: 0, done: 0, total: 1 })
  })

  it('leaves out upcoming habits', async () => {
    const body = await today('2026-10-26')
    expect([...names(body.slots.morning), ...names(body.slots.evening)]).not.toContain('Someday')
  })

  it('rejects a malformed date and a future one', async () => {
    expect((await app.request('/api/today/2026-10-32', { headers: { cookie } })).status).toBe(400)
    expect((await app.request('/api/today/2099-01-01', { headers: { cookie } })).status).toBe(400)
  })

  it('requires a session', async () => {
    expect((await app.request('/api/today/2026-10-26')).status).toBe(401)
  })
})
