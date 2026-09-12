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
}

export interface DashboardDay {
  date: string
  completed: boolean
  value: number | null
  note: string | null
  level: ActivityLevel
}

export interface DashboardHabit {
  id: number
  name: string
  kind: HabitKind
  unit: string | null
  target: number | null
  notesEnabled: boolean
  activatedAt: string | null
  health: Health
  streak: number
  rate: number
  days: DashboardDay[]
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
}

export type UpdateHabitInput = Partial<Omit<Habit, 'id' | 'createdAt' | 'activatedAt'>>

/** Surfaces the server's own message so the UI can say what actually went wrong. */
async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null)
    throw new Error(message ?? `Request failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

function send(path: string, method: string, body: unknown) {
  return fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function fetchDashboard(weeks = 15): Promise<DashboardResponse> {
  return json<DashboardResponse>(await fetch(`/api/dashboard?weeks=${weeks}`))
}

export async function fetchLog(date: string): Promise<LogResponse> {
  return json<LogResponse>(await fetch(`/api/log/${date}`))
}

export async function saveLog(date: string, entries: LogEntryInput[]): Promise<LogResponse> {
  return json<LogResponse>(await send(`/api/log/${date}`, 'PUT', { entries }))
}

export async function fetchHabits(status?: HabitStatus): Promise<Habit[]> {
  const query = status ? `?status=${status}` : ''
  const body = await json<{ habits: Habit[] }>(await fetch(`/api/habits${query}`))
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
