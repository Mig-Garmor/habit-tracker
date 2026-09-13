import { useAuth } from './auth'

export type HabitKind = 'binary' | 'quantity'
export type HabitStatus = 'active' | 'upcoming' | 'archived'
export type Health = 'new' | 'struggling' | 'steady' | 'consistent'
export type ActivityLevel = 0 | 1 | 2 | 3 | 4

export interface Habit {
  id: number
  name: string
  kind: HabitKind
  unit: string | null
  target: number | null
  notesEnabled: boolean
  status: HabitStatus
  activatedAt: string | null
  createdAt: string
  timesPerWeek: number
}

export interface DashboardDay {
  date: string
  completed: boolean
  value: number | null
  note: string | null
  level: ActivityLevel
}

export interface DashboardWeek {
  start: string
  completed: number
  expected: number
  met: boolean
}

export interface DashboardHabit {
  id: number
  name: string
  kind: HabitKind
  unit: string | null
  target: number | null
  notesEnabled: boolean
  activatedAt: string | null
  timesPerWeek: number
  health: Health
  streak: number
  rate: number
  days: DashboardDay[]
  weeks: DashboardWeek[]
}

export interface DashboardWarning {
  habitId: number
  name: string
  rate: number
}

export interface DashboardResponse {
  today: string
  from: string
  habits: DashboardHabit[]
  warnings: DashboardWarning[]
}

export interface LogEntry {
  completed: boolean
  value: number | null
  note: string | null
}

export interface LogHabit {
  id: number
  name: string
  kind: HabitKind
  unit: string | null
  target: number | null
  notesEnabled: boolean
  entry: LogEntry | null
}

export interface LogResponse {
  date: string
  isToday: boolean
  habits: LogHabit[]
}

export interface LogEntryInput {
  habitId: number
  completed?: boolean
  value?: number | null
  note?: string | null
}

export interface CreateHabitInput {
  name: string
  kind?: HabitKind
  unit?: string | null
  target?: number | null
  notesEnabled?: boolean
  status?: 'active' | 'upcoming'
  timesPerWeek?: number
}

export type UpdateHabitInput = Partial<Omit<Habit, 'id' | 'createdAt' | 'activatedAt'>>

/**
 * The app is two processes: Vite serves the pages and proxies /api to the Hono
 * server. When that server is not running the proxy answers with a gateway
 * error, and when nothing is listening at all `fetch` rejects outright. Both
 * mean the same thing, and "status 502" tells you nothing useful about it.
 */
const API_UNREACHABLE_STATUSES = new Set([502, 503, 504])

const API_UNREACHABLE =
  'Can’t reach the API. It runs as a second process — start both with `pnpm dev`.'

/** Surfaces the server's own message so the UI can say what actually went wrong. */
async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 401) {
      // An expired or missing session should read as "sign in again", not as a
      // generic failure on whichever screen happened to be open. `clearSession`
      // updates shared state unconditionally; the redirect is browser-only so
      // this file stays importable under vitest's node environment.
      useAuth().clearSession()
      if (typeof window !== 'undefined') {
        window.location.assign('/login')
      }
      throw new Error('Your session has expired. Please sign in again.')
    }

    if (API_UNREACHABLE_STATUSES.has(response.status)) {
      throw new Error(API_UNREACHABLE)
    }

    const message = await response
      .json()
      .then((body: { error?: unknown }) => (typeof body.error === 'string' ? body.error : null))
      .catch(() => null)
    // `@hono/zod-validator` returns `{ error: <ZodError> }` on a 400 — an
    // object, not a string. Only ever surface a genuine string message;
    // statusText is empty in some runtimes, so fall back to the status code.
    throw new Error(message ?? `Request failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

/** Every request goes through here so a dead server reads the same either way. */
async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init)
  } catch {
    // fetch only rejects on a transport failure — nothing is listening at all.
    throw new Error(API_UNREACHABLE)
  }
}

function send(path: string, method: string, body: unknown) {
  return request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function fetchDashboard(weeks = 15): Promise<DashboardResponse> {
  return json<DashboardResponse>(await request(`/api/dashboard?weeks=${weeks}`))
}

export async function fetchLog(date: string): Promise<LogResponse> {
  return json<LogResponse>(await request(`/api/log/${date}`))
}

export async function saveLog(date: string, entries: LogEntryInput[]): Promise<LogResponse> {
  return json<LogResponse>(await send(`/api/log/${date}`, 'PUT', { entries }))
}

export async function fetchHabits(status?: HabitStatus): Promise<Habit[]> {
  const query = status ? `?status=${status}` : ''
  const body = await json<{ habits: Habit[] }>(await request(`/api/habits${query}`))
  return body.habits
}

export async function createHabit(input: CreateHabitInput): Promise<Habit> {
  const body = await json<{ habit: Habit }>(await send('/api/habits', 'POST', input))
  return body.habit
}

export async function updateHabit(id: number, input: UpdateHabitInput): Promise<Habit> {
  const body = await json<{ habit: Habit }>(await send(`/api/habits/${id}`, 'PATCH', input))
  return body.habit
}

/**
 * Sends the complete order for one status group. Whole-list rather than a
 * position delta, so replaying it is a no-op and a dropped response cannot
 * leave the server holding an order the client never intended.
 */
export async function reorderHabits(ids: number[]): Promise<void> {
  await send('/api/habits/reorder', 'PUT', { ids })
}
