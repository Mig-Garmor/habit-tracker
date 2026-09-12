/**
 * Date helpers for habit tracking. Days are local calendar days keyed as
 * YYYY-MM-DD — never UTC, or a habit ticked at 11pm lands on tomorrow.
 */

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function today(): string {
  return toDateKey(new Date())
}

export function previousDay(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year!, month! - 1, day! - 1)
  return toDateKey(date)
}

export function nextDay(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return toDateKey(new Date(year!, month! - 1, day! + 1))
}

/** True only for a real calendar day written exactly as YYYY-MM-DD. */
export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year!, month! - 1, day!)
  // Rejects 2026-02-30, which Date would silently roll into March.
  return toDateKey(date) === value
}

/** Every day from `from` to `to`, both ends included. Empty if `from` is later. */
export function dateRange(from: string, to: string): string[] {
  if (from > to) return []
  const days: string[] = []
  let cursor = from
  while (cursor <= to) {
    days.push(cursor)
    cursor = nextDay(cursor)
  }
  return days
}

/** The `n` days ending at `upTo`, ascending. */
export function lastNDays(n: number, upTo: string): string[] {
  if (n <= 0) return []
  let start = upTo
  for (let i = 1; i < n; i++) start = previousDay(start)
  return dateRange(start, upTo)
}

/** The Monday on or before `dateKey`. Grids start on week boundaries. */
export function startOfWeek(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year!, month! - 1, day!)
  // getDay(): 0 = Sunday. Monday-based offset puts Sunday six days past Monday.
  const offset = (date.getDay() + 6) % 7
  let cursor = dateKey
  for (let i = 0; i < offset; i++) cursor = previousDay(cursor)
  return cursor
}

/**
 * Consecutive completed days ending at today, or at yesterday when today has
 * not been logged yet (D-4) — otherwise every streak reads 0 each morning.
 */
export function currentStreak(completedDates: Iterable<string>, today: string): number {
  const completed = new Set(completedDates)
  let cursor = completed.has(today) ? today : previousDay(today)
  let streak = 0
  while (completed.has(cursor)) {
    streak += 1
    cursor = previousDay(cursor)
  }
  return streak
}
