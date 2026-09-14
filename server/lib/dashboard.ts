import {
  classifyHealth, completionRate, currentStreak, summariseWeeks, type Health, type WeekSummary,
} from './consistency.js'
import { dateRange, endOfWeek, lastNWeekStarts, nextWeek, startOfWeek, weekStartsInRange } from './date.js'
import { activityLevel, type ActivityLevel } from './level.js'

export interface DashboardHabitInput {
  id: number
  name: string
  kind: 'binary' | 'quantity'
  unit: string | null
  target: number | null
  notesEnabled: boolean
  activatedAt: string | null
  /** How many times a week the habit is meant to happen. 7 is daily (D-26). */
  timesPerWeek: number
}

export interface DashboardEntryInput {
  habitId: number
  date: string
  completed: boolean
  value: number | null
  note: string | null
}

export interface DashboardDay {
  date: string
  completed: boolean
  value: number | null
  note: string | null
  level: ActivityLevel
  /**
   * A date the grid draws but nobody could have logged yet. Sent rather than
   * derived so the client keeps rendering values instead of recomputing them —
   * and because an empty future square must not read as a missed day.
   */
  future: boolean
}

export interface DashboardHabit extends DashboardHabitInput {
  health: Health
  streak: number
  rate: number
  days: DashboardDay[]
  weeks: WeekSummary[]
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

/**
 * How many whole weeks the grid draws AHEAD of today.
 *
 * Five of fifteen columns puts today's week tenth — about two thirds across —
 * so the grid shows a run-up and a runway instead of ending abruptly at today.
 */
export const FUTURE_WEEKS = 5

/**
 * The week-aligned range the grid draws for `weeks` columns ending `FUTURE_WEEKS`
 * beyond today.
 *
 * `weeks` stays the TOTAL column count, as it always was, so the grid's width
 * is unchanged and the future columns are bought out of history rather than
 * added on top. That is deliberate: widening the grid would take ~76px from
 * the text column beside it, and on a 375px phone that column is already the
 * tighter of the two.
 */
export function dashboardRange(today: string, weeks: number): { from: string, to: string } {
  // At least one week of history, however few columns were asked for —
  // otherwise `to` precedes `from` and the grid comes back empty.
  const past = Math.max(1, weeks - FUTURE_WEEKS)

  let lastWeek = startOfWeek(today)
  for (let i = 0; i < FUTURE_WEEKS; i++) lastWeek = nextWeek(lastWeek)

  return { from: lastNWeekStarts(past, today)[0]!, to: endOfWeek(lastWeek) }
}

/**
 * Turns habit and entry rows into the dashboard payload: one dense day per date
 * in the range, each already shaded, plus health, streak and rate. The client
 * renders these values and never recomputes them.
 *
 * `to` and `today` are deliberately separate. `to` is where the DRAWING stops
 * and may sit weeks in the future, so today's square lands partway across the
 * grid instead of at its right edge. `today` is where the SCORING stops, and
 * every streak, rate and health call below still anchors on it — lengthening
 * the grid must never dilute a score with weeks nobody has lived through.
 */
export function buildDashboard(
  habits: DashboardHabitInput[],
  entries: DashboardEntryInput[],
  from: string,
  today: string,
  to: string,
): DashboardResponse {
  const dates = dateRange(from, to)

  const byHabit = new Map<number, Map<string, DashboardEntryInput>>()
  for (const entry of entries) {
    let forHabit = byHabit.get(entry.habitId)
    if (!forHabit) {
      forHabit = new Map()
      byHabit.set(entry.habitId, forHabit)
    }
    forHabit.set(entry.date, entry)
  }

  const built = habits.map((habit): DashboardHabit => {
    const forHabit = byHabit.get(habit.id) ?? new Map<string, DashboardEntryInput>()

    const days = dates.map((date): DashboardDay => {
      const entry = forHabit.get(date)
      return {
        date,
        completed: entry?.completed ?? false,
        value: entry?.value ?? null,
        note: entry?.note ?? null,
        level: activityLevel(habit, entry ?? null),
        future: date > today,
      }
    })

    const completedDates = [...forHabit.values()]
      .filter(entry => entry.completed)
      .map(entry => entry.date)

    return {
      ...habit,
      days,
      streak: currentStreak(completedDates, today, habit.activatedAt, habit.timesPerWeek),
      rate: completionRate(completedDates, today, habit.activatedAt, habit.timesPerWeek),
      health: classifyHealth(completedDates, today, habit.activatedAt, habit.timesPerWeek),
      // Every week in the rendered range, not the (shorter) scoring window —
      // otherwise a habit kept for a year shows the cadence marker on only the
      // newest few columns, which now reads as "the rest failed" (D-23).
      // Scoring keeps using weekSummaries/completionRate; this is display only.
      weeks: habit.activatedAt
        ? summariseWeeks(completedDates, weekStartsInRange(from, to), habit.timesPerWeek)
        : [],
    }
  })

  return {
    today,
    from,
    habits: built,
    warnings: built
      .filter(habit => habit.health === 'struggling')
      .map(habit => ({ habitId: habit.id, name: habit.name, rate: habit.rate })),
  }
}
