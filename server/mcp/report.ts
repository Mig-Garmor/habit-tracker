import type { HabitSlot } from '../db/schema.js'
import type { TodayHabit, TodayResponse } from '../lib/today.js'

/**
 * The daily report: one fixed shape, so a week of them reads alike. Pure —
 * the tool gathers the data, this only arranges it.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface Objectives {
  date: string
  note: string
  /** True when nothing was written this week and this is an earlier week's. */
  stale: boolean
}

export interface ReportItem {
  habit: string
  status: string
  done: boolean
  carriedFrom: string | null
}

export interface Report {
  date: string
  slots: Partial<Record<HabitSlot, { done: number, total: number, progress: number, items: ReportItem[] }>>
  objectives: Objectives | null
  notes: { habit: string, note: string }[]
}

function weekdayOf(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return WEEKDAYS[new Date(year!, month! - 1, day!).getDay()]!
}

function status(habit: TodayHabit): string {
  const entry = habit.entry
  if (habit.kind === 'quantity') {
    return entry?.value ? `${entry.value} of ${habit.target} ${habit.unit ?? ''}`.trim() : 'not yet'
  }
  if (habit.kind === 'checklist' && habit.steps.length > 0) {
    const ticked = entry?.steps?.length ?? 0
    return ticked ? `${ticked} of ${habit.steps.length} steps` : 'not yet'
  }
  return entry?.completed ? 'done' : 'not yet'
}

export function buildReport(today: TodayResponse, objectives: Objectives | null): Report {
  const slots: Report['slots'] = {}
  for (const slot of ['morning', 'evening'] as const) {
    if (slot === 'morning' && !today.morningVisible) continue
    const { habits, done, total, progress } = today.slots[slot]
    slots[slot] = {
      done,
      total,
      progress,
      items: habits.map(habit => ({
        habit: habit.name,
        status: status(habit),
        done: habit.entry?.completed ?? false,
        carriedFrom: habit.carriedFrom,
      })),
    }
  }

  const notes = [...today.slots.morning.habits, ...today.slots.evening.habits]
    .flatMap(habit => (habit.entry?.note ? [{ habit: habit.name, note: habit.entry.note }] : []))

  return { date: today.date, slots, objectives, notes }
}

export function renderReport(report: Report): string {
  const lines = [`# Daily report — ${weekdayOf(report.date)} ${report.date}`]

  for (const [slot, title] of [['morning', 'Morning'], ['evening', 'Evening']] as const) {
    const section = report.slots[slot]
    if (!section) continue
    lines.push('', `## ${title} — ${section.done} of ${section.total} done (${Math.round(section.progress * 100)}%)`)
    for (const item of section.items) {
      const carried = item.carriedFrom ? ` (carried from ${weekdayOf(item.carriedFrom)})` : ''
      lines.push(`- [${item.done ? 'x' : ' '}] ${item.habit} — ${item.status}${carried}`)
    }
  }

  const objectives = report.objectives
  if (!objectives) {
    lines.push('', '## This week\'s objectives', 'None written yet.')
  } else if (objectives.stale) {
    lines.push('', `## This week's objectives (none this week — last set ${weekdayOf(objectives.date)} ${objectives.date})`, objectives.note)
  } else {
    lines.push('', `## This week's objectives (set ${weekdayOf(objectives.date)} ${objectives.date})`, objectives.note)
  }

  if (report.notes.length) {
    lines.push('', '## Notes today', ...report.notes.map(({ habit, note }) => `- ${habit}: ${note}`))
  }

  return lines.join('\n')
}
