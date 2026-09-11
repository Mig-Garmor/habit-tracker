export interface TodayHabit {
  id: number
  name: string
  completed: boolean
}

export interface TodayResponse {
  date: string
  habits: TodayHabit[]
}

export interface ToggleResponse {
  id: number
  date: string
  completed: boolean
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

export async function fetchToday(): Promise<TodayResponse> {
  return json<TodayResponse>(await fetch('/api/habits/today'))
}

export async function toggleHabit(id: number): Promise<ToggleResponse> {
  return json<ToggleResponse>(await fetch(`/api/habits/${id}/toggle`, { method: 'POST' }))
}
