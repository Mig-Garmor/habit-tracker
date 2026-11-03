import type { HabitKind } from '../db/schema.js'
import { startOfWeek, weekDays } from './date.js'

/**
 * Which day a habit is listed on, and how far through it a slot is. Pure, so
 * the Today route and anything reading it later (MCP) agree by construction.
 */

/**
 * The hour the evening takes over on a weekday (D-29). The browser keeps its
 * own copy in src/lib/day-part.ts; the server needs it for MCP's `front`.
 */
export const EVENING_STARTS_AT = 17

/** ISO weekday of a local date key: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(year!, month! - 1, day!).getDay()
  return weekday === 0 ? 7 : weekday
}

/** Whether the habit is meant to appear on this weekday (D-27). */
export function isScheduled(habit: { weekdays: number[] }, date: string): boolean {
  return habit.weekdays.includes(isoWeekday(date))
}

/**
 * The earliest scheduled day earlier this week the habit still owes, or null
 * (D-31). Completions are counted strictly BEFORE `date`: a habit caught up
 * today must stay on today's list, ticked, rather than vanish on the refetch
 * that follows the tick.
 */
export function owedFrom(
  habit: { weekdays: number[], timesPerWeek: number },
  date: string,
  completedDates: Iterable<string>,
): string | null {
  const completed = new Set(completedDates)
  const before = weekDays(startOfWeek(date)).filter(day => day < date)

  const passed = before.filter(day => isScheduled(habit, day))
  if (passed.length === 0) return null

  const doneSoFar = before.filter(day => completed.has(day)).length
  const owed = Math.min(passed.length, habit.timesPerWeek)
  if (doneSoFar >= owed) return null

  return passed.find(day => !completed.has(day)) ?? passed[0]!
}

export interface ProgressHabit {
  kind: HabitKind
  /** For a checklist, the server keeps this equal to its step count (D-30). */
  target: number | null
}

export interface ProgressEntry {
  completed: boolean
  value: number | null
}

/** How far through today a habit is, 0 to 1 (D-33). */
export function habitProgress(habit: ProgressHabit, entry: ProgressEntry | null): number {
  if (!entry) return 0

  const measured = habit.kind === 'quantity' || habit.kind === 'checklist'
  if (measured && habit.target !== null && habit.target > 0) {
    return Math.min(1, (entry.value ?? 0) / habit.target)
  }
  // Binary, journal, and a checklist with no steps yet: done or not.
  return entry.completed ? 1 : 0
}

/** The collapsed bar's numbers: mean progress, and how many are done. */
export function slotProgress(items: { progress: number, completed: boolean }[]) {
  if (items.length === 0) return { progress: 0, done: 0, total: 0 }
  const sum = items.reduce((total, item) => total + item.progress, 0)
  return {
    progress: sum / items.length,
    done: items.filter(item => item.completed).length,
    total: items.length,
  }
}
