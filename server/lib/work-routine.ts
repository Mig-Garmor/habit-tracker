import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { habits, habitSteps, type HabitKind } from '../db/schema.js'

/** The morning work habits from the Today view spec. */
export const WORK_ROUTINE: {
  name: string
  kind: HabitKind
  weekdays: number[]
  timesPerWeek: number
  notesEnabled: boolean
  question: string
  steps: string[]
}[] = [
  {
    name: 'Plan the week',
    kind: 'checklist',
    weekdays: [1],
    timesPerWeek: 1,
    // The note holds the week's objectives, which the MCP server reads back.
    notesEnabled: true,
    question: 'What has to be finished by Friday, and in what order?',
    steps: [
      'Check tasks in progress (team and mine)',
      'Check available tasks',
      'Check open PRs in catena-unicorn',
      'Order the tasks to tackle',
      'Decide the end-of-week target',
    ],
  },
  {
    name: 'Check what each team member is working on',
    kind: 'checklist',
    weekdays: [1, 2, 3, 4, 5],
    timesPerWeek: 5,
    notesEnabled: false,
    question: 'Is anyone blocked, or carrying more than two COS tickets?',
    // Teammates' names are added in the app; until then it ticks as a whole.
    steps: [],
  },
  {
    name: 'Recap team initiatives',
    kind: 'journal',
    weekdays: [1, 2, 3, 4, 5],
    timesPerWeek: 5,
    notesEnabled: true,
    question: 'Which initiatives moved since yesterday, and which stalled?',
    steps: [],
  },
  {
    name: 'What did I do today',
    kind: 'journal',
    weekdays: [1, 2, 3, 4, 5],
    timesPerWeek: 5,
    notesEnabled: true,
    question: 'What did I ship, unblock or decide today?',
    steps: [],
  },
]

/**
 * Adds whichever routine habits are missing, matched by name, and returns the
 * names it added. Safe to re-run; it never touches a habit that exists.
 */
export async function seedWorkRoutine(
  db: PgDatabase<PgQueryResultHKT, Record<string, unknown>>,
  activatedAt: string,
): Promise<string[]> {
  const existing = new Set((await db.select({ name: habits.name }).from(habits)).map(row => row.name))
  const missing = WORK_ROUTINE.filter(habit => !existing.has(habit.name))

  return db.transaction(async tx => {
    for (const { steps, ...habit } of missing) {
      const [created] = await tx.insert(habits).values({
        ...habit,
        slot: 'morning',
        status: 'active',
        activatedAt,
        // A checklist's target is its step count (D-30).
        target: habit.kind === 'checklist' && steps.length ? steps.length : null,
      }).returning({ id: habits.id })
      if (steps.length) {
        await tx.insert(habitSteps).values(steps.map((label, position) => ({ habitId: created!.id, label, position })))
      }
    }
    return missing.map(habit => habit.name)
  })
}
