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

/**
 * Consecutive completed days ending at `upTo`, counting backwards.
 * A gap on `upTo` itself means a streak of 0.
 */
export function currentStreak(completedDates: Iterable<string>, upTo: string): number {
  const completed = new Set(completedDates)
  let streak = 0
  let cursor = upTo
  while (completed.has(cursor)) {
    streak += 1
    cursor = previousDay(cursor)
  }
  return streak
}
