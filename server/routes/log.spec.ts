import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DashboardResponse } from '../lib/dashboard'
import { createTestDb } from '../test/pg-harness'

const holder = vi.hoisted(() => ({ db: undefined as unknown }))

// A getter, not a value: the database does not exist until beforeAll runs, and
// the routes read this binding on every call rather than capturing it once.
vi.mock('../db/client', () => ({
  get db() {
    return holder.db
  },
}))

interface CreateHabitResponse {
  habit: { id: number }
}

interface LogHabitEntry {
  completed: boolean
  value: number | null
  note: string | null
}

interface LogHabit {
  id: number
  name: string
  kind: string
  unit: string | null
  target: number | null
  notesEnabled: boolean
  entry: LogHabitEntry | null
}

interface LogDayResponse {
  date: string
  isToday: boolean
  habits: LogHabit[]
}

let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }
let todayKey: string
let exerciseId: number
let meditationId: number
let closeTestDb: () => Promise<void>

async function readJson<T>(response: Response | Promise<Response>): Promise<T> {
  return (await (await response).json()) as T
}

beforeAll(async () => {
  const { db, close } = await createTestDb()
  holder.db = db
  closeTestDb = close

  todayKey = (await import('../lib/date')).today()
  app = (await import('../app')).createApp()

  const create = async (body: unknown) => {
    const { habit } = await readJson<CreateHabitResponse>(app.request('/api/habits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
    return habit.id
  }

  exerciseId = await create({ name: 'Exercise', notesEnabled: true })
  meditationId = await create({ name: 'Meditation', kind: 'quantity', unit: 'minutes', target: 10 })
})

afterAll(async () => {
  await closeTestDb()
})

function put(date: string, entries: unknown[]) {
  return app.request(`/api/log/${date}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries }),
  })
}

describe('GET /api/log/:date', () => {
  it('returns every active habit with a null entry when nothing is logged', async () => {
    const body = await readJson<LogDayResponse>(app.request('/api/log/2026-01-05'))
    expect(body.date).toBe('2026-01-05')
    expect(body.isToday).toBe(false)
    expect(body.habits).toHaveLength(2)
    expect(body.habits.every(h => h.entry === null)).toBe(true)
  })

  it('marks today as today', async () => {
    const body = await readJson<LogDayResponse>(app.request(`/api/log/${todayKey}`))
    expect(body.isToday).toBe(true)
  })

  it('rejects a malformed date', async () => {
    const response = await app.request('/api/log/2026-9-5')
    expect(response.status).toBe(400)
  })

  it('rejects a date that does not exist', async () => {
    const response = await app.request('/api/log/2026-02-30')
    expect(response.status).toBe(400)
  })

  it('rejects a future date', async () => {
    const response = await app.request('/api/log/2099-01-01')
    expect(response.status).toBe(400)
  })
})

describe('PUT /api/log/:date', () => {
  it('saves a binary habit with a note', async () => {
    const response = await put('2026-01-06', [
      { habitId: exerciseId, completed: true, note: 'squats, 5k' },
    ])
    expect(response.status).toBe(200)

    const body = await readJson<LogDayResponse>(response)
    const exercise = body.habits.find(h => h.id === exerciseId)!
    expect(exercise.entry).toEqual({ completed: true, value: null, note: 'squats, 5k' })
  })

  it('derives completed from the value for a quantity habit (D-1)', async () => {
    const body = await readJson<LogDayResponse>(
      put('2026-01-07', [{ habitId: meditationId, value: 5, completed: false }]),
    )
    const meditation = body.habits.find(h => h.id === meditationId)!
    // Client said completed:false; the server trusts the value instead.
    expect(meditation.entry!.completed).toBe(true)
    expect(meditation.entry!.value).toBe(5)
  })

  it('treats a logged zero as not completed', async () => {
    const body = await readJson<LogDayResponse>(put('2026-01-08', [{ habitId: meditationId, value: 0 }]))
    const meditation = body.habits.find(h => h.id === meditationId)!
    expect(meditation.entry!.completed).toBe(false)
  })

  it('overwrites an existing day rather than duplicating it', async () => {
    await put('2026-01-09', [{ habitId: meditationId, value: 5 }])
    const body = await readJson<LogDayResponse>(put('2026-01-09', [{ habitId: meditationId, value: 30 }]))
    const meditation = body.habits.find(h => h.id === meditationId)!
    expect(meditation.entry!.value).toBe(30)
  })

  it('leaves habits absent from the body untouched', async () => {
    await put('2026-01-10', [{ habitId: exerciseId, completed: true }])
    await put('2026-01-10', [{ habitId: meditationId, value: 10 }])

    const body = await readJson<LogDayResponse>(app.request('/api/log/2026-01-10'))
    const exercise = body.habits.find(h => h.id === exerciseId)!
    expect(exercise.entry!.completed).toBe(true)
  })

  it('stores a blank note as null', async () => {
    const body = await readJson<LogDayResponse>(
      put('2026-01-11', [{ habitId: exerciseId, completed: true, note: '   ' }]),
    )
    const exercise = body.habits.find(h => h.id === exerciseId)!
    expect(exercise.entry!.note).toBeNull()
  })

  it('preserves an existing note when a later save omits it (D-6)', async () => {
    await put('2026-01-14', [{ habitId: exerciseId, completed: true, note: 'squats, 5k' }])
    const body = await readJson<LogDayResponse>(
      put('2026-01-14', [{ habitId: exerciseId, completed: true }]),
    )
    const exercise = body.habits.find(h => h.id === exerciseId)
    expect(exercise?.entry?.note).toBe('squats, 5k')
  })

  it('rejects a future date', async () => {
    const response = await put('2099-01-01', [{ habitId: exerciseId, completed: true }])
    expect(response.status).toBe(400)
  })

  it('404s for a habit that does not exist', async () => {
    const response = await put('2026-01-12', [{ habitId: 9999, completed: true }])
    expect(response.status).toBe(404)
  })

  it('rejects entries for an archived habit', async () => {
    const { habit } = await readJson<CreateHabitResponse>(app.request('/api/habits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Old habit' }),
    }))

    await app.request(`/api/habits/${habit.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    })

    const response = await put('2026-01-13', [{ habitId: habit.id, completed: true }])
    expect(response.status).toBe(400)
  })

  it('rolls back the whole batch when a later entry is invalid', async () => {
    const { habit: archived } = await readJson<CreateHabitResponse>(app.request('/api/habits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Retired habit' }),
    }))
    await app.request(`/api/habits/${archived.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    })

    const response = await put('2026-01-15', [
      { habitId: exerciseId, completed: true },
      { habitId: archived.id, completed: true },
    ])
    expect(response.status).toBe(400)

    const body = await readJson<LogDayResponse>(app.request('/api/log/2026-01-15'))
    const exercise = body.habits.find(h => h.id === exerciseId)!
    expect(exercise.entry).toBeNull()
  })
})

describe('GET /api/dashboard', () => {
  it('returns a dense grid for every active habit', async () => {
    const body = await readJson<DashboardResponse>(app.request('/api/dashboard?weeks=2'))
    expect(body.today).toBe(todayKey)
    expect(body.habits.length).toBeGreaterThanOrEqual(2)

    for (const habit of body.habits) {
      expect(habit.days[0]!.date).toBe(body.from)
      expect(habit.days.at(-1)!.date).toBe(todayKey)
      expect(habit.days.every(d => d.level >= 0 && d.level <= 4)).toBe(true)
    }
  })

  it('clamps an absurd weeks value', async () => {
    const body = await readJson<DashboardResponse>(app.request('/api/dashboard?weeks=9999'))
    expect(body.habits[0]!.days.length).toBeLessThanOrEqual(53 * 7 + 7)
  })

  it('falls back to the default for a non-numeric weeks value', async () => {
    const response = await app.request('/api/dashboard?weeks=banana')
    expect(response.status).toBe(200)
  })
})
