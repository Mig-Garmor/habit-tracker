import type { Habit, HabitEntry, HabitSlot, HabitStep } from '../db/schema.js'
import { habitProgress, isoWeekday, isScheduled, owedFrom, slotProgress } from './schedule.js'

export interface TodayEntry {
  completed: boolean
  value: number | null
  note: string | null
  steps?: number[] | null
}

export interface TodayHabit {
  id: number
  name: string
  kind: Habit['kind']
  unit: string | null
  target: number | null
  notesEnabled: boolean
  question: string | null
  timesPerWeek: number
  steps: { id: number, label: string }[]
  /** Set only when listed because it is owed, not scheduled today (D-31). */
  carriedFrom: string | null
  progress: number
  entry: TodayEntry | null
}

export interface TodaySlot {
  habits: TodayHabit[]
  progress: number
  done: number
  total: number
}

export interface TodayResponse {
  date: string
  weekday: number
  /** False at the weekend: there is no work slot to show (D-29). */
  morningVisible: boolean
  slots: Record<HabitSlot, TodaySlot>
}

/**
 * Both slots for one day. `habits` are the active habits in display order;
 * `entries` must cover at least the Monday of `date`'s week up to `date`, which
 * is all the carry-over rule looks at.
 */
export function buildToday(
  habits: Habit[],
  steps: Map<number, HabitStep[]>,
  entries: HabitEntry[],
  date: string,
): TodayResponse {
  const weekday = isoWeekday(date)
  const morningVisible = weekday <= 5

  const listed = habits.flatMap((habit): TodayHabit[] => {
    if (habit.slot === 'morning' && !morningVisible) return []

    const mine = entries.filter(entry => entry.habitId === habit.id)
    const completedDates = mine.filter(entry => entry.completed).map(entry => entry.date)
    const scheduled = isScheduled(habit, date)
    const carriedFrom = scheduled ? null : owedFrom(habit, date, completedDates)
    if (!scheduled && carriedFrom === null) return []

    const entry = mine.find(row => row.date === date) ?? null
    return [{
      id: habit.id,
      name: habit.name,
      kind: habit.kind,
      unit: habit.unit,
      target: habit.target,
      notesEnabled: habit.notesEnabled,
      question: habit.question,
      timesPerWeek: habit.timesPerWeek,
      steps: (steps.get(habit.id) ?? []).map(step => ({ id: step.id, label: step.label })),
      carriedFrom,
      progress: habitProgress(habit, entry),
      entry: entry
        ? {
            completed: entry.completed,
            value: entry.value,
            note: entry.note,
            ...(habit.kind === 'checklist' ? { steps: entry.steps } : {}),
          }
        : null,
    }]
  })

  const slot = (name: HabitSlot): TodaySlot => {
    const inSlot = listed.filter(item => habits.find(habit => habit.id === item.id)!.slot === name)
    return {
      habits: inSlot,
      ...slotProgress(inSlot.map(item => ({ progress: item.progress, completed: item.entry?.completed ?? false }))),
    }
  }

  return { date, weekday, morningVisible, slots: { morning: slot('morning'), evening: slot('evening') } }
}
