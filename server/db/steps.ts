import { asc, inArray } from 'drizzle-orm'
import { db } from './client.js'
import { habitSteps, type HabitStep } from './schema.js'

/** Each habit's checklist steps in order, keyed by habit id. */
export async function stepsByHabit(habitIds: number[]): Promise<Map<number, HabitStep[]>> {
  const rows = habitIds.length
    ? await db.select().from(habitSteps).where(inArray(habitSteps.habitId, habitIds))
      .orderBy(asc(habitSteps.position), asc(habitSteps.id))
    : []
  const byHabit = new Map<number, HabitStep[]>()
  for (const row of rows) byHabit.set(row.habitId, [...(byHabit.get(row.habitId) ?? []), row])
  return byHabit
}
