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

/** The seven days of the week beginning `weekStart`, Monday first. */
export function weekDays(weekStart: string): string[] {
  const days = [weekStart]
  for (let i = 1; i < 7; i++) days.push(nextDay(days[i - 1]!))
  return days
}

/** The Monday seven days after `weekStart`. */
export function nextWeek(weekStart: string): string {
  let cursor = weekStart
  for (let i = 0; i < 7; i++) cursor = nextDay(cursor)
  return cursor
}

/** The Monday seven days before `weekStart`. */
export function previousWeek(weekStart: string): string {
  let cursor = weekStart
  for (let i = 0; i < 7; i++) cursor = previousDay(cursor)
  return cursor
}

/**
 * The Mondays of the `n` weeks ending with the week that contains `upTo`,
 * ascending. The last element is always `startOfWeek(upTo)`.
 */
export function lastNWeekStarts(n: number, upTo: string): string[] {
  if (n <= 0) return []
  const starts = [startOfWeek(upTo)]
  for (let i = 1; i < n; i++) starts.unshift(previousWeek(starts[0]!))
  return starts
}

/**
 * Whether the whole week beginning `weekStart` is in the past. The week
 * containing `today` is never complete — not even on its last day, which is
 * still being lived (D-21).
 */
export function isWeekComplete(weekStart: string, today: string): boolean {
  return weekStart < startOfWeek(today)
}

/**
 * Every Monday from the week containing `from` to the week containing `upTo`,
 * ascending, both ends included. Used to describe a rendered date range in
 * whole weeks rather than the scoring window, which uses `lastNWeekStarts`
 * instead.
 */
export function weekStartsInRange(from: string, upTo: string): string[] {
  const starts: string[] = []
  let cursor = startOfWeek(from)
  const last = startOfWeek(upTo)
  while (cursor <= last) {
    starts.push(cursor)
    cursor = nextWeek(cursor)
  }
  return starts
}
