import type { HabitSlot } from './api'

/**
 * Which slot the Today view puts in front, read from the browser's own clock
 * (D-29). The server never guesses the time of day: it runs in UTC.
 */

/** The hour the evening takes over on a weekday. server/lib/schedule.ts keeps a copy for MCP. */
export const EVENING_STARTS_AT = 17

function isWeekend(now: Date): boolean {
  const day = now.getDay()
  return day === 0 || day === 6
}

/** False at the weekend, when there is no work slot at all. */
export function morningVisible(now: Date): boolean {
  return !isWeekend(now)
}

export function frontSlot(now: Date): HabitSlot {
  if (isWeekend(now)) return 'evening'
  return now.getHours() < EVENING_STARTS_AT ? 'morning' : 'evening'
}

/** The local calendar day as YYYY-MM-DD — never toISOString, which is UTC. */
export function dateKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
