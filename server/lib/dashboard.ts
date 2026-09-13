import {
  classifyHealth, completionRate, currentStreak, weekSummaries, type Health, type WeekSummary,
} from './consistency.js'
import { dateRange } from './date.js'
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
 * Turns habit and entry rows into the dashboard payload: one dense day per date
 * in the range, each already shaded, plus health, streak and rate. The client
 * renders these values and never recomputes them.
 */
export function buildDashboard(
  habits: DashboardHabitInput[],
  entries: DashboardEntryInput[],
  from: string,
  today: string,
): DashboardResponse {
  const dates = dateRange(from, today)

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
      weeks: weekSummaries(completedDates, today, habit.activatedAt, habit.timesPerWeek),
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
