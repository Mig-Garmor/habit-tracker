/**
 * The 0-4 shade of one activity square (D-2). Levels are relative to the
 * habit's CURRENT target, so raising a target re-shades history while leaving
 * every recorded value untouched.
 */

export type ActivityLevel = 0 | 1 | 2 | 3 | 4

export interface LevelHabit {
  kind: 'binary' | 'quantity'
  target: number | null
}

export interface LevelEntry {
  completed: boolean
  value: number | null
}

/** What a completed binary day shades to — mid-strength, so it reads as "done". */
const BINARY_DONE: ActivityLevel = 3

export function activityLevel(
  habit: LevelHabit,
  entry: LevelEntry | null | undefined,
): ActivityLevel {
  if (!entry) return 0

  const hasUsableTarget = habit.kind === 'quantity' && habit.target !== null && habit.target > 0
  if (!hasUsableTarget) {
    return entry.completed ? BINARY_DONE : 0
  }

  const value = entry.value ?? 0
  if (value <= 0) return 0

  const ratio = value / habit.target!
  if (ratio < 0.5) return 1
  if (ratio < 1) return 2
  if (ratio < 1.5) return 3
  return 4
}
