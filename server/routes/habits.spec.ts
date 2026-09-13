import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Habit } from '../db/schema.js'
import { createTestDb } from '../test/pg-harness.js'
import { signedCookieHeader, TEST_EMAIL, TEST_SESSION_SECRET } from '../test/session-cookie.js'

const holder = vi.hoisted(() => ({ db: undefined as unknown }))

// A getter, not a value: the database does not exist until beforeAll runs, and
// the routes read this binding on every call rather than capturing it once.
vi.mock('../db/client', () => ({
  get db() {
    return holder.db
  },
  isDatabaseConfigured: () => true,
}))

let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }
let closeTestDb: () => Promise<void>
let cookie: string

async function readJson<T>(response: Response | Promise<Response>): Promise<T> {
  return (await (await response).json()) as T
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SESSION_SECRET
  process.env.ALLOWED_EMAILS = TEST_EMAIL
  cookie = await signedCookieHeader()

  const { db, close } = await createTestDb()
  holder.db = db
  closeTestDb = close
  app = (await import('../app.js')).createApp()
})

afterAll(async () => {
  await closeTestDb()
})

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

function patch(path: string, body: unknown) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

describe('POST /api/habits', () => {
  it('creates a binary habit and starts its grace period', async () => {
    const response = await post('/api/habits', { name: 'Exercise', notesEnabled: true })
    expect(response.status).toBe(201)

    const { habit } = await readJson<{ habit: Habit }>(response)
    expect(habit.name).toBe('Exercise')
    expect(habit.kind).toBe('binary')
    expect(habit.status).toBe('active')
    expect(habit.activatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('leaves an upcoming habit unactivated', async () => {
    const { habit } = await readJson<{ habit: Habit }>(post('/api/habits', { name: 'Journal', status: 'upcoming' }))
    expect(habit.status).toBe('upcoming')
    expect(habit.activatedAt).toBeNull()
  })

  it('rejects a quantity habit with no target', async () => {
    const response = await post('/api/habits', { name: 'Meditation', kind: 'quantity', unit: 'minutes' })
    expect(response.status).toBe(400)
  })

  it('rejects a quantity habit with no unit', async () => {
    const response = await post('/api/habits', { name: 'Meditation', kind: 'quantity', target: 10 })
    expect(response.status).toBe(400)
  })

  it('rejects an empty name', async () => {
    expect((await post('/api/habits', { name: '   ' })).status).toBe(400)
  })

  it('rejects a negative target', async () => {
    const response = await post('/api/habits', {
      name: 'Meditation', kind: 'quantity', unit: 'minutes', target: -5,
    })
    expect(response.status).toBe(400)
  })
})

describe('GET /api/habits', () => {
  it('filters by status', async () => {
    const response = await app.request('/api/habits?status=upcoming', { headers: { cookie } })
    const { habits } = await readJson<{ habits: Habit[] }>(response)
    expect(habits.every(h => h.status === 'upcoming')).toBe(true)
    expect(habits.length).toBeGreaterThan(0)
  })

  it('returns every habit when no status is given', async () => {
    const { habits } = await readJson<{ habits: Habit[] }>(app.request('/api/habits', { headers: { cookie } }))
    const statuses = new Set(habits.map(h => h.status))
    expect(statuses.size).toBeGreaterThan(1)
  })

  it('rejects an unknown status', async () => {
    expect((await app.request('/api/habits?status=banana', { headers: { cookie } })).status).toBe(400)
  })
})

describe('PATCH /api/habits/:id', () => {
  it('activating an upcoming habit sets activatedAt (D-3)', async () => {
    const { habit } = await readJson<{ habit: Habit }>(post('/api/habits', { name: 'Stretch', status: 'upcoming' }))
    expect(habit.activatedAt).toBeNull()

    const { habit: activated } = await readJson<{ habit: Habit }>(patch(`/api/habits/${habit.id}`, { status: 'active' }))
    expect(activated.status).toBe('active')
    expect(activated.activatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('changes a target without touching activatedAt', async () => {
    const { habit } = await readJson<{ habit: Habit }>(post('/api/habits', {
      name: 'Meditation', kind: 'quantity', unit: 'minutes', target: 5,
    }))

    const { habit: updated } = await readJson<{ habit: Habit }>(patch(`/api/habits/${habit.id}`, { target: 10 }))
    expect(updated.target).toBe(10)
    expect(updated.activatedAt).toBe(habit.activatedAt)
  })

  it('404s for a habit that does not exist', async () => {
    expect((await patch('/api/habits/9999', { name: 'Nope' })).status).toBe(404)
  })

  it('rejects a patch that would leave a quantity habit without a target', async () => {
    const { habit } = await readJson<{ habit: Habit }>(post('/api/habits', {
      name: 'Read', kind: 'quantity', unit: 'pages', target: 10,
    }))

    const response = await patch(`/api/habits/${habit.id}`, { target: null })
    expect(response.status).toBe(400)
  })

  it('allows a name-only patch on an existing quantity habit', async () => {
    const { habit } = await readJson<{ habit: Habit }>(post('/api/habits', {
      name: 'Read', kind: 'quantity', unit: 'pages', target: 10,
    }))

    const response = await patch(`/api/habits/${habit.id}`, { name: 'Read more' })
    expect(response.status).toBe(200)

    const { habit: updated } = await readJson<{ habit: Habit }>(response)
    expect(updated.name).toBe('Read more')
    expect(updated.unit).toBe('pages')
    expect(updated.target).toBe(10)
  })
})

describe('PUT /api/habits/reorder', () => {
  // Seeded here rather than relying on what earlier describes happened to
  // leave behind: this suite shares one database, and depending on another
  // test's side effects makes a failure here point at the wrong place.
  let parked: Habit

  beforeAll(async () => {
    for (const name of ['Reorder A', 'Reorder B', 'Reorder C']) {
      await post('/api/habits', { name })
    }
    const body = await readJson<{ habit: Habit }>(post('/api/habits', { name: 'Reorder parked', status: 'upcoming' }))
    parked = body.habit
  })

  async function ids(): Promise<number[]> {
    const body = await readJson<{ habits: Habit[] }>(app.request('/api/habits?status=active', { headers: { cookie } }))
    return body.habits.map(h => h.id)
  }

  async function reorder(order: number[]) {
    return app.request('/api/habits/reorder', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ids: order }),
    })
  }

  it('puts the habits in the order given', async () => {
    const before = await ids()
    expect(before.length).toBeGreaterThan(2)

    const reversed = [...before].reverse()
    expect((await reorder(reversed)).status).toBe(200)
    expect(await ids()).toEqual(reversed)
  })

  it('is idempotent — sending the same order twice changes nothing', async () => {
    const order = [...(await ids())].reverse()
    await reorder(order)
    await reorder(order)
    expect(await ids()).toEqual(order)
  })

  it('rejects an order that omits a habit in the group', async () => {
    const before = await ids()
    const response = await reorder(before.slice(1))
    expect(response.status).toBe(400)
    // The stored order must be untouched by a rejected request.
    expect(await ids()).toEqual(before)
  })

  it('rejects an order containing an unknown habit id', async () => {
    const before = await ids()
    const response = await reorder([...before, 999_999])
    expect(response.status).toBe(400)
    expect(await ids()).toEqual(before)
  })

  it('rejects an order that mixes habits from different status groups', async () => {
    const activeIds = await ids()
    const response = await reorder([...activeIds, parked.id])
    expect(response.status).toBe(400)
    expect(await ids()).toEqual(activeIds)
  })

  it('rejects a duplicated id', async () => {
    const before = await ids()
    const response = await reorder([before[0]!, ...before])
    expect(response.status).toBe(400)
    expect(await ids()).toEqual(before)
  })

  it('requires a session', async () => {
    const response = await app.request('/api/habits/reorder', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [1] }),
    })
    expect(response.status).toBe(401)
  })
})
