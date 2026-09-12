# Habit Tracking Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scaffold's single tick-box screen with an activity-grid dashboard, a day-logging screen, and an active/upcoming habit lifecycle that warns when a habit isn't sticking.

**Architecture:** Every interesting rule is a pure function in `server/lib/*` with a co-located `.spec.ts`, so levels, streaks, consistency and the whole dashboard payload are tested without touching a database. Hono routes stay thin: query, call a pure builder, return. The Vue side renders server-computed values — it never recomputes a level or a health state.

**Tech Stack:** Vue 3 + TypeScript, vue-router v5 file-based routing, Tailwind v3 authored inside SCSS, shadcn-vue components, Hono, Drizzle ORM, better-sqlite3, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-12-habit-tracking-core-design.md` — read it alongside this plan. Every decision labelled D-1..D-6 there is binding.

## Global Constraints

- **Dates are local calendar days, `YYYY-MM-DD`.** Never UTC. Never `toISOString().slice(0,10)`.
- **Tailwind lives in SCSS.** Every component gets a sibling `.scss` referenced as `<style lang="scss" scoped src="./Name.scss"></style>`. No utility classes in templates.
- **`src/components/ui/*` is vendored** shadcn code — never hand-edit. Add components with `npx shadcn-vue@1.0.3 add <name>` (the `@1.0.3` pin matters; 2.x targets Tailwind v4 and this project is on v3).
- **Use design tokens** (`bg-background`, `text-muted-foreground`, `border-border`, …), never raw palette colours.
- **`completed` for a quantity habit is derived server-side** from `value > 0` (D-1). Never trust the client's `completed`.
- **Levels are 0–4 integers computed on the server** (D-2). The client only renders them.
- After editing `server/db/schema.ts`, run `pnpm db:generate` then `pnpm db:migrate` — never hand-write migration SQL.
- Run `pnpm typecheck` and `pnpm test` before every commit.

## File Structure

**Server — pure logic (no DB, no IO):**
- `server/lib/date.ts` *(modify)* — add `nextDay`, `isValidDateKey`, `dateRange`, `lastNDays`, `startOfWeek`; change `currentStreak` per D-4
- `server/lib/level.ts` *(create)* — `activityLevel`
- `server/lib/consistency.ts` *(create)* — thresholds, `completionRate`, `classifyHealth`
- `server/lib/dashboard.ts` *(create)* — `buildDashboard`, assembles the whole dashboard payload

**Server — IO edges:**
- `server/db/schema.ts` *(modify)* — new columns on both tables
- `server/validation.ts` *(create)* — Zod schemas shared by routes
- `server/app.ts` *(create)* — builds the Hono app; extracted so tests can call it without opening a port
- `server/index.ts` *(modify)* — imports the app and serves it
- `server/routes/habits.ts` *(rewrite)* — list/create/update
- `server/routes/dashboard.ts` *(create)*
- `server/routes/log.ts` *(create)*

**Scripts:**
- `scripts/seed.ts` *(modify)* — the four real habits
- `package.json` *(modify)* — a `db:reset` script chaining rm, migrate and seed

**Web:**
- `src/lib/api.ts` *(rewrite)* — types + fetch wrappers
- `src/components/ActivityGrid.vue` + `.scss` *(create)*
- `src/components/HealthPill.vue` + `.scss` *(create)*
- `src/components/LogHabitCard.vue` + `.scss` *(create)*
- `src/components/HabitItem.vue` + `.scss` *(delete)* — superseded by `LogHabitCard`
- `src/pages/index.vue` + `.scss` *(rewrite)* — dashboard
- `src/pages/log.vue` + `.scss` *(create)*
- `src/pages/habits.vue` + `.scss` *(create)*
- `src/App.vue` / `App.scss` *(modify)* — nav

---

### Task 1: Extend the date module

Adds the calendar helpers everything else needs, and changes `currentStreak` per **D-4** so a streak survives an unlogged today.

**Files:**
- Modify: `server/lib/date.ts`
- Test: `server/lib/date.spec.ts` (modify — one existing test changes meaning)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `toDateKey(date: Date): string` *(exists)*
  - `today(): string` *(exists)*
  - `previousDay(dateKey: string): string` *(exists)*
  - `nextDay(dateKey: string): string`
  - `isValidDateKey(value: string): boolean`
  - `dateRange(from: string, to: string): string[]` — inclusive both ends; `[]` if `from > to`
  - `lastNDays(n: number, upTo: string): string[]` — ascending, includes `upTo`
  - `startOfWeek(dateKey: string): string` — the Monday on or before
  - `currentStreak(completedDates: Iterable<string>, today: string): number` *(behaviour changes)*

- [ ] **Step 1: Delete the outdated streak test**

In `server/lib/date.spec.ts`, remove this test entirely — D-4 reverses it:

```ts
  it('is 0 when today is not completed', () => {
    expect(currentStreak(['2026-09-09', '2026-09-10'], '2026-09-11')).toBe(0)
  })
```

- [ ] **Step 2: Write the failing tests**

Replace the import line and append these suites to `server/lib/date.spec.ts`:

```ts
import { currentStreak, dateRange, isValidDateKey, lastNDays, nextDay, previousDay, startOfWeek, toDateKey } from './date'
```

```ts
describe('nextDay', () => {
  it('steps forward one day', () => {
    expect(nextDay('2026-09-11')).toBe('2026-09-12')
  })

  it('rolls forward across a month boundary', () => {
    expect(nextDay('2026-08-31')).toBe('2026-09-01')
  })

  it('rolls forward across a year boundary', () => {
    expect(nextDay('2025-12-31')).toBe('2026-01-01')
  })
})

describe('isValidDateKey', () => {
  it('accepts a well-formed key', () => {
    expect(isValidDateKey('2026-09-11')).toBe(true)
  })

  it('rejects the wrong shape', () => {
    expect(isValidDateKey('2026-9-11')).toBe(false)
    expect(isValidDateKey('11-09-2026')).toBe(false)
    expect(isValidDateKey('')).toBe(false)
  })

  it('rejects a date that does not exist', () => {
    expect(isValidDateKey('2026-02-30')).toBe(false)
    expect(isValidDateKey('2026-13-01')).toBe(false)
  })
})

describe('dateRange', () => {
  it('includes both ends', () => {
    expect(dateRange('2026-09-09', '2026-09-12')).toEqual([
      '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12',
    ])
  })

  it('returns a single day when both ends match', () => {
    expect(dateRange('2026-09-09', '2026-09-09')).toEqual(['2026-09-09'])
  })

  it('crosses a month boundary', () => {
    expect(dateRange('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
    ])
  })

  it('is empty when from is after to', () => {
    expect(dateRange('2026-09-12', '2026-09-09')).toEqual([])
  })
})

describe('lastNDays', () => {
  it('returns n days ascending, ending at upTo', () => {
    expect(lastNDays(3, '2026-09-12')).toEqual(['2026-09-10', '2026-09-11', '2026-09-12'])
  })

  it('returns just upTo for n of 1', () => {
    expect(lastNDays(1, '2026-09-12')).toEqual(['2026-09-12'])
  })

  it('is empty for n of 0', () => {
    expect(lastNDays(0, '2026-09-12')).toEqual([])
  })
})

describe('startOfWeek', () => {
  it('returns the same day when it is already Monday', () => {
    expect(startOfWeek('2026-09-07')).toBe('2026-09-07')
  })

  it('walks back to Monday from a Saturday', () => {
    expect(startOfWeek('2026-09-12')).toBe('2026-09-07')
  })

  it('walks back to Monday from a Sunday', () => {
    expect(startOfWeek('2026-09-13')).toBe('2026-09-07')
  })

  it('crosses a month boundary', () => {
    expect(startOfWeek('2026-09-02')).toBe('2026-08-31')
  })
})

describe('currentStreak', () => {
  it('counts back from an unlogged today (D-4)', () => {
    expect(currentStreak(['2026-09-09', '2026-09-10', '2026-09-11'], '2026-09-12')).toBe(3)
  })

  it('includes today when today is completed', () => {
    expect(currentStreak(['2026-09-11', '2026-09-12'], '2026-09-12')).toBe(2)
  })

  it('is 0 when neither today nor yesterday is completed', () => {
    expect(currentStreak(['2026-09-09', '2026-09-10'], '2026-09-12')).toBe(0)
  })
})
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run server/lib/date.spec.ts`
Expected: FAIL — `nextDay is not a function`, plus the new `currentStreak` cases failing.

- [ ] **Step 4: Implement**

Append to `server/lib/date.ts`, and replace the existing `currentStreak`:

```ts
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
```

```ts
/**
 * Consecutive completed days ending at today, or at yesterday when today has
 * not been logged yet (D-4) — otherwise every streak reads 0 each morning.
 */
export function currentStreak(completedDates: Iterable<string>, today: string): number {
  const completed = new Set(completedDates)
  let cursor = completed.has(today) ? today : previousDay(today)
  let streak = 0
  while (completed.has(cursor)) {
    streak += 1
    cursor = previousDay(cursor)
  }
  return streak
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run server/lib/date.spec.ts`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add server/lib/date.ts server/lib/date.spec.ts
git commit -m "feat(date): add range helpers and let streaks survive an unlogged today

currentStreak now counts back from yesterday when today has no entry (D-4),
so a streak no longer reads 0 every morning until you log."
```

---

### Task 2: Activity levels

The 0–4 shade for one square. Pure, and the only place the level rule lives (D-2).

**Files:**
- Create: `server/lib/level.ts`
- Test: `server/lib/level.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type ActivityLevel = 0 | 1 | 2 | 3 | 4`
  - `interface LevelHabit { kind: 'binary' | 'quantity'; target: number | null }`
  - `interface LevelEntry { completed: boolean; value: number | null }`
  - `activityLevel(habit: LevelHabit, entry: LevelEntry | null | undefined): ActivityLevel`

- [ ] **Step 1: Write the failing test**

Create `server/lib/level.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { activityLevel } from './level'

const binary = { kind: 'binary' as const, target: null }
const meditation = { kind: 'quantity' as const, target: 10 }

describe('activityLevel', () => {
  it('is 0 when there is no entry', () => {
    expect(activityLevel(binary, null)).toBe(0)
    expect(activityLevel(meditation, undefined)).toBe(0)
  })

  describe('binary habits', () => {
    it('is 3 when completed', () => {
      expect(activityLevel(binary, { completed: true, value: null })).toBe(3)
    })

    it('is 0 when not completed', () => {
      expect(activityLevel(binary, { completed: false, value: null })).toBe(0)
    })
  })

  describe('quantity habits against a target of 10', () => {
    it('is 0 for a logged zero', () => {
      expect(activityLevel(meditation, { completed: false, value: 0 })).toBe(0)
    })

    it('is 1 below half the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 4 })).toBe(1)
    })

    it('is 2 at exactly half the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 5 })).toBe(2)
    })

    it('is 2 just under the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 9 })).toBe(2)
    })

    it('is 3 at exactly the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 10 })).toBe(3)
    })

    it('is 3 just under 1.5x the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 14 })).toBe(3)
    })

    it('is 4 at 1.5x the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 15 })).toBe(4)
    })

    it('is 4 well over the target', () => {
      expect(activityLevel(meditation, { completed: true, value: 60 })).toBe(4)
    })
  })

  it('keeps the old 5-minute days lighter than new 10-minute days (D-2)', () => {
    const fiveMinuteDay = activityLevel(meditation, { completed: true, value: 5 })
    const tenMinuteDay = activityLevel(meditation, { completed: true, value: 10 })
    expect(fiveMinuteDay).toBeLessThan(tenMinuteDay)
  })

  describe('quantity habits without a usable target', () => {
    it('falls back to binary shading', () => {
      const noTarget = { kind: 'quantity' as const, target: null }
      expect(activityLevel(noTarget, { completed: true, value: 7 })).toBe(3)
      expect(activityLevel(noTarget, { completed: false, value: 0 })).toBe(0)
    })

    it('treats a zero target as unusable rather than dividing by it', () => {
      const zeroTarget = { kind: 'quantity' as const, target: 0 }
      expect(activityLevel(zeroTarget, { completed: true, value: 7 })).toBe(3)
    })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run server/lib/level.spec.ts`
Expected: FAIL — cannot find module `./level`.

- [ ] **Step 3: Implement**

Create `server/lib/level.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run server/lib/level.spec.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add server/lib/level.ts server/lib/level.spec.ts
git commit -m "feat(level): shade activity squares by amount logged (D-2)"
```

---

### Task 3: Consistency and health

The rule behind the warning. Pure, thresholds in one place.

**Files:**
- Create: `server/lib/consistency.ts`
- Test: `server/lib/consistency.spec.ts`

**Interfaces:**
- Consumes: `lastNDays`, `dateRange` from `server/lib/date.ts`
- Produces:
  - `GRACE_DAYS`, `WINDOW_DAYS`, `STRUGGLING_BELOW`, `CONSISTENT_AT_OR_ABOVE` constants
  - `type Health = 'new' | 'struggling' | 'steady' | 'consistent'`
  - `completionRate(completedDates: Iterable<string>, today: string, activatedAt: string | null): number`
  - `classifyHealth(completedDates: Iterable<string>, today: string, activatedAt: string | null): Health`

- [ ] **Step 1: Write the failing test**

Create `server/lib/consistency.spec.ts`. `daysBefore` builds a run of completed days ending at a given date, so the tests read as "did N of the last M".

```ts
import { describe, expect, it } from 'vitest'
import { classifyHealth, completionRate } from './consistency'
import { lastNDays, previousDay } from './date'

const TODAY = '2026-09-30'

/** A habit activated long enough ago that the grace period never applies. */
const LONG_AGO = '2026-01-01'

/** The `count` most recent days ending at TODAY. */
function recentDays(count: number): string[] {
  return lastNDays(count, TODAY)
}

describe('completionRate', () => {
  it('is 0 with no completed days', () => {
    expect(completionRate([], TODAY, LONG_AGO)).toBe(0)
  })

  it('is 1 when every day in the window is completed', () => {
    expect(completionRate(recentDays(14), TODAY, LONG_AGO)).toBe(1)
  })

  it('counts only the trailing 14 days', () => {
    // 30 completed days, but the window is 14 — still a perfect rate, not 2.1.
    expect(completionRate(recentDays(30), TODAY, LONG_AGO)).toBe(1)
  })

  it('is a half for 7 of the last 14', () => {
    expect(completionRate(recentDays(7), TODAY, LONG_AGO)).toBe(0.5)
  })

  it('ignores days older than the window', () => {
    const old = lastNDays(10, previousDay(lastNDays(14, TODAY)[0]!))
    expect(completionRate(old, TODAY, LONG_AGO)).toBe(0)
  })

  it('judges a young habit only on days since it was activated', () => {
    // Activated 4 days ago, did 2 of those 4 — that is 0.5, not 2/14.
    const activatedAt = lastNDays(4, TODAY)[0]!
    expect(completionRate(recentDays(2), TODAY, activatedAt)).toBe(0.5)
  })

  it('is 0 when the habit has never been activated', () => {
    expect(completionRate(recentDays(5), TODAY, null)).toBe(0)
  })
})

describe('classifyHealth', () => {
  it('is new inside the grace period, however badly it is going', () => {
    const activatedAt = lastNDays(13, TODAY)[0]!
    expect(classifyHealth([], TODAY, activatedAt)).toBe('new')
  })

  it('leaves the grace period on day 14', () => {
    const activatedAt = lastNDays(15, TODAY)[0]!
    expect(classifyHealth([], TODAY, activatedAt)).toBe('struggling')
  })

  it('is new when never activated', () => {
    expect(classifyHealth([], TODAY, null)).toBe('new')
  })

  it('is struggling below half', () => {
    // 6 of 14 is 0.43
    expect(classifyHealth(recentDays(6), TODAY, LONG_AGO)).toBe('struggling')
  })

  it('is steady at exactly half', () => {
    expect(classifyHealth(recentDays(7), TODAY, LONG_AGO)).toBe('steady')
  })

  it('is steady between the thresholds', () => {
    // 10 of 14 is 0.71
    expect(classifyHealth(recentDays(10), TODAY, LONG_AGO)).toBe('steady')
  })

  it('is consistent at exactly the upper threshold', () => {
    // 12 of 14 is 0.857; 11 of 14 is 0.786 and must not qualify
    expect(classifyHealth(recentDays(12), TODAY, LONG_AGO)).toBe('consistent')
    expect(classifyHealth(recentDays(11), TODAY, LONG_AGO)).toBe('steady')
  })

  it('is consistent at a perfect rate', () => {
    expect(classifyHealth(recentDays(14), TODAY, LONG_AGO)).toBe('consistent')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run server/lib/consistency.spec.ts`
Expected: FAIL — cannot find module `./consistency`.

- [ ] **Step 3: Implement**

Create `server/lib/consistency.ts`:

```ts
import { dateRange, lastNDays } from './date'

/**
 * How consistent a habit is, and whether to suggest parking it. Change these
 * four numbers and the whole warning system moves with them.
 */
export const GRACE_DAYS = 14
export const WINDOW_DAYS = 14
export const STRUGGLING_BELOW = 0.5
export const CONSISTENT_AT_OR_ABOVE = 0.8

export type Health = 'new' | 'struggling' | 'steady' | 'consistent'

/**
 * Completed days over eligible days in the trailing window. Days before the
 * habit was activated are excluded from the denominator, so a habit active for
 * four days is judged out of four rather than out of fourteen.
 */
export function completionRate(
  completedDates: Iterable<string>,
  today: string,
  activatedAt: string | null,
): number {
  if (!activatedAt) return 0

  const eligible = lastNDays(WINDOW_DAYS, today).filter(date => date >= activatedAt)
  if (eligible.length === 0) return 0

  const completed = new Set(completedDates)
  const done = eligible.filter(date => completed.has(date)).length
  return done / eligible.length
}

/** Whole days since activation — 0 on the activation day itself. */
function daysSinceActivation(activatedAt: string, today: string): number {
  return Math.max(0, dateRange(activatedAt, today).length - 1)
}

export function classifyHealth(
  completedDates: Iterable<string>,
  today: string,
  activatedAt: string | null,
): Health {
  if (!activatedAt) return 'new'
  if (daysSinceActivation(activatedAt, today) < GRACE_DAYS) return 'new'

  const rate = completionRate(completedDates, today, activatedAt)
  if (rate < STRUGGLING_BELOW) return 'struggling'
  if (rate >= CONSISTENT_AT_OR_ABOVE) return 'consistent'
  return 'steady'
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run server/lib/consistency.spec.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add server/lib/consistency.ts server/lib/consistency.spec.ts
git commit -m "feat(consistency): rate a habit over a trailing 14-day window"
```

---

### Task 4: Schema, migration, seed and reset

Reshapes both tables, then replaces the three throwaway starters with the four real habits.

**Files:**
- Modify: `server/db/schema.ts`
- Create: `drizzle/0001_*.sql` (generated — do not hand-write, but see Step 3)
- Modify: `scripts/seed.ts`
- Modify: `package.json` (add `db:reset`)

**Interfaces:**
- Consumes: `today()` from `server/lib/date.ts`
- Produces: `habits` and `habitEntries` tables with the columns below; `Habit` and `HabitEntry` inferred types; `habitKinds` and `habitStatuses` const tuples for reuse in Zod schemas

- [ ] **Step 1: Rewrite the schema**

Replace `server/db/schema.ts` entirely:

```ts
import { sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const habitKinds = ['binary', 'quantity'] as const
export const habitStatuses = ['active', 'upcoming', 'archived'] as const

export type HabitKind = (typeof habitKinds)[number]
export type HabitStatus = (typeof habitStatuses)[number]

export const habits = sqliteTable('habits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  kind: text('kind', { enum: habitKinds }).notNull().default('binary'),
  /** Label for the logged amount, e.g. "minutes". Null for binary habits. */
  unit: text('unit'),
  /** Daily goal for quantity habits. Drives square shading (D-2). */
  target: real('target'),
  notesEnabled: integer('notes_enabled', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: habitStatuses }).notNull().default('active'),
  /** Day the habit last entered `active` — starts the grace period (D-3). */
  activatedAt: text('activated_at'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
})

export const habitEntries = sqliteTable(
  'habit_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    habitId: integer('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    /** Local calendar day, YYYY-MM-DD. One row per habit per day. */
    date: text('date').notNull(),
    /** Showed up at all. Derived from `value > 0` for quantity habits (D-1). */
    completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
    /** Minutes, reps, … for quantity habits. Null for binary. */
    value: real('value'),
    note: text('note'),
  },
  t => [uniqueIndex('habit_entries_habit_date_idx').on(t.habitId, t.date)],
)

export type Habit = typeof habits.$inferSelect
export type HabitEntry = typeof habitEntries.$inferSelect
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: `[✓] Your SQL migration file ➜ drizzle/0001_<name>.sql`

- [ ] **Step 3: Append the backfill to the generated migration**

The generator can add columns but does not know what to put in them. Open the new
`drizzle/0001_*.sql` and append, so an existing active habit doesn't sit permanently in the
grace period with a null `activated_at`:

```sql
--> statement-breakpoint
UPDATE habits SET activated_at = date(created_at) WHERE status = 'active' AND activated_at IS NULL;
```

`created_at` is a timestamp (`2026-09-11 20:53:18`) and `activated_at` is a day, hence
`date(...)`. This is the one sanctioned edit to generated SQL — a data backfill, never a
schema change.

- [ ] **Step 4: Rewrite the seed**

Replace `scripts/seed.ts`:

```ts
/**
 * The four habits being tracked. Safe to re-run: it does nothing if any habits
 * already exist, so it never duplicates or overwrites real history.
 */
import { db, sqlite } from '../server/db/client'
import { habits } from '../server/db/schema'
import { today } from '../server/lib/date'

const STARTERS = [
  { name: 'Exercise', kind: 'binary', unit: null, target: null, notesEnabled: true },
  { name: 'Code reading', kind: 'quantity', unit: 'minutes', target: 15, notesEnabled: false },
  { name: 'Meditation', kind: 'quantity', unit: 'minutes', target: 5, notesEnabled: false },
  { name: 'Record one video', kind: 'binary', unit: null, target: null, notesEnabled: false },
] as const

const existing = db.select().from(habits).all()

if (existing.length > 0) {
  console.log(`Skipped: ${existing.length} habit(s) already exist.`)
} else {
  const activatedAt = today()
  db.insert(habits)
    .values(STARTERS.map(habit => ({ ...habit, status: 'active' as const, activatedAt })))
    .run()
  console.log(`Seeded ${STARTERS.length} habits.`)
}

sqlite.close()
```

- [ ] **Step 5: Add the reset script**

In `package.json`, add to `scripts`:

```json
"db:reset": "rm -f data/habits.db data/habits.db-shm data/habits.db-wal && pnpm db:migrate && pnpm db:seed"
```

- [ ] **Step 6: Reset and verify**

Run: `pnpm db:reset`
Expected: migrations applied, then `Seeded 4 habits.`

Verify the shape landed:

```bash
node -e "
const D=require('better-sqlite3');const db=new D('data/habits.db',{readonly:true});
console.table(db.prepare('select id,name,kind,unit,target,notes_enabled,status,activated_at from habits').all());
console.log('entry columns:', db.prepare('select * from pragma_table_info(\'habit_entries\')').all().map(c=>c.name).join(', '));
"
```

Expected: four rows — Exercise (binary, notes_enabled 1), Code reading (quantity/minutes/15),
Meditation (quantity/minutes/5), Record one video (binary) — all `status` active with today's
`activated_at`; entry columns include `value` and `note`.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck && pnpm test
git add server/db/schema.ts drizzle scripts/seed.ts package.json
git commit -m "feat(db): entries record a value and a note; habits gain a lifecycle

Adds kind/unit/target/notesEnabled/status/activatedAt to habits and
value/note to entries, replacing archivedAt with a three-state status.
Seeds the four real habits."
```

---

### Task 5: Dashboard payload builder

Assembles the whole dashboard response from rows. Pure, so the interesting part needs no database.

**Files:**
- Create: `server/lib/dashboard.ts`
- Test: `server/lib/dashboard.spec.ts`

**Interfaces:**
- Consumes: `activityLevel`, `ActivityLevel` from `./level`; `classifyHealth`, `completionRate`, `Health` from `./consistency`; `currentStreak`, `dateRange` from `./date`
- Produces:
  - `interface DashboardHabitInput { id: number; name: string; kind: 'binary' | 'quantity'; unit: string | null; target: number | null; notesEnabled: boolean; activatedAt: string | null }`
  - `interface DashboardEntryInput { habitId: number; date: string; completed: boolean; value: number | null; note: string | null }`
  - `interface DashboardDay { date: string; completed: boolean; value: number | null; note: string | null; level: ActivityLevel }`
  - `interface DashboardHabit extends DashboardHabitInput { health: Health; streak: number; rate: number; days: DashboardDay[] }`
  - `interface DashboardWarning { habitId: number; name: string; rate: number }`
  - `interface DashboardResponse { today: string; from: string; habits: DashboardHabit[]; warnings: DashboardWarning[] }`
  - `buildDashboard(habits: DashboardHabitInput[], entries: DashboardEntryInput[], from: string, today: string): DashboardResponse`

- [ ] **Step 1: Write the failing test**

Create `server/lib/dashboard.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildDashboard } from './dashboard'

const TODAY = '2026-09-12'
const FROM = '2026-09-07'

const exercise = {
  id: 1, name: 'Exercise', kind: 'binary' as const, unit: null,
  target: null, notesEnabled: true, activatedAt: '2026-01-01',
}

const meditation = {
  id: 2, name: 'Meditation', kind: 'quantity' as const, unit: 'minutes',
  target: 10, notesEnabled: false, activatedAt: '2026-01-01',
}

function entry(habitId: number, date: string, value: number | null, note: string | null = null) {
  return { habitId, date, completed: value === null ? true : value > 0, value, note }
}

describe('buildDashboard', () => {
  it('returns a dense day per date in the range, entry or not', () => {
    const result = buildDashboard([exercise], [entry(1, '2026-09-09', null)], FROM, TODAY)
    expect(result.habits[0]!.days.map(d => d.date)).toEqual([
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12',
    ])
  })

  it('shades each day from its entry', () => {
    const result = buildDashboard(
      [meditation],
      [entry(2, '2026-09-08', 4), entry(2, '2026-09-09', 10), entry(2, '2026-09-10', 20)],
      FROM,
      TODAY,
    )
    const levels = Object.fromEntries(result.habits[0]!.days.map(d => [d.date, d.level]))
    expect(levels['2026-09-07']).toBe(0)
    expect(levels['2026-09-08']).toBe(1)
    expect(levels['2026-09-09']).toBe(3)
    expect(levels['2026-09-10']).toBe(4)
  })

  it('carries value and note through to the day', () => {
    const result = buildDashboard([exercise], [entry(1, '2026-09-09', null, 'squats, 5k')], FROM, TODAY)
    const day = result.habits[0]!.days.find(d => d.date === '2026-09-09')!
    expect(day.note).toBe('squats, 5k')
    expect(day.completed).toBe(true)
  })

  it('keeps each habit to its own entries', () => {
    const result = buildDashboard(
      [exercise, meditation],
      [entry(1, '2026-09-09', null), entry(2, '2026-09-10', 10)],
      FROM,
      TODAY,
    )
    expect(result.habits[0]!.days.filter(d => d.completed).map(d => d.date)).toEqual(['2026-09-09'])
    expect(result.habits[1]!.days.filter(d => d.completed).map(d => d.date)).toEqual(['2026-09-10'])
  })

  it('computes a streak that tolerates an unlogged today', () => {
    const result = buildDashboard(
      [exercise],
      [entry(1, '2026-09-10', null), entry(1, '2026-09-11', null)],
      FROM,
      TODAY,
    )
    expect(result.habits[0]!.streak).toBe(2)
  })

  it('echoes the range it was given', () => {
    const result = buildDashboard([exercise], [], FROM, TODAY)
    expect(result.today).toBe(TODAY)
    expect(result.from).toBe(FROM)
  })

  it('warns only about struggling habits', () => {
    const result = buildDashboard([exercise, meditation], [], FROM, TODAY)
    expect(result.habits.map(h => h.health)).toEqual(['struggling', 'struggling'])
    expect(result.warnings.map(w => w.habitId)).toEqual([1, 2])
  })

  it('does not warn about a habit inside its grace period', () => {
    const fresh = { ...exercise, activatedAt: TODAY }
    const result = buildDashboard([fresh], [], FROM, TODAY)
    expect(result.habits[0]!.health).toBe('new')
    expect(result.warnings).toEqual([])
  })

  it('handles a habit with no entries at all', () => {
    const result = buildDashboard([exercise], [], FROM, TODAY)
    expect(result.habits[0]!.streak).toBe(0)
    expect(result.habits[0]!.rate).toBe(0)
    expect(result.habits[0]!.days.every(d => d.level === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run server/lib/dashboard.spec.ts`
Expected: FAIL — cannot find module `./dashboard`.

- [ ] **Step 3: Implement**

Create `server/lib/dashboard.ts`:

```ts
import { classifyHealth, completionRate, type Health } from './consistency'
import { currentStreak, dateRange } from './date'
import { activityLevel, type ActivityLevel } from './level'

export interface DashboardHabitInput {
  id: number
  name: string
  kind: 'binary' | 'quantity'
  unit: string | null
  target: number | null
  notesEnabled: boolean
  activatedAt: string | null
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
      streak: currentStreak(completedDates, today),
      rate: completionRate(completedDates, today, habit.activatedAt),
      health: classifyHealth(completedDates, today, habit.activatedAt),
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
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run server/lib/dashboard.spec.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add server/lib/dashboard.ts server/lib/dashboard.spec.ts
git commit -m "feat(dashboard): build the dashboard payload from rows"
```

---

### Task 6: Validation, app extraction, and the habits routes

Splits the Hono app out of the listener so tests can drive it without a port, then rebuilds the habits endpoints with Zod validation and the lifecycle rules.

**Files:**
- Create: `server/validation.ts`
- Create: `server/app.ts`
- Modify: `server/index.ts`
- Rewrite: `server/routes/habits.ts`
- Test: `server/routes/habits.spec.ts`

**Interfaces:**
- Consumes: `habitKinds`, `habitStatuses`, `habits` from `server/db/schema.ts`; `isValidDateKey`, `today` from `server/lib/date.ts`
- Produces:
  - `createApp(): Hono` from `server/app.ts`
  - `dateKeySchema`, `createHabitSchema`, `updateHabitSchema`, `logEntrySchema`, `logPayloadSchema` from `server/validation.ts`
  - `habitsRoutes` — `GET /`, `POST /`, `PATCH /:id`

- [ ] **Step 1: Install the validation dependencies**

```bash
pnpm add zod @hono/zod-validator
```

- [ ] **Step 2: Write the validation schemas**

Create `server/validation.ts`:

```ts
import { z } from 'zod'
import { habitKinds, habitStatuses } from './db/schema'
import { isValidDateKey } from './lib/date'

export const dateKeySchema = z
  .string()
  .refine(isValidDateKey, 'Expected a real calendar date as YYYY-MM-DD')

const name = z.string().trim().min(1, 'Name is required').max(80)
const unit = z.string().trim().min(1).max(20).nullable()
const target = z.number().positive('Target must be greater than zero').nullable()

/** A quantity habit is meaningless without something to count and a goal to count against. */
function quantityIsComplete(habit: { kind: string, unit: unknown, target: unknown }) {
  return habit.kind !== 'quantity' || (habit.unit !== null && habit.target !== null)
}

export const createHabitSchema = z
  .object({
    name,
    kind: z.enum([...habitKinds]).default('binary'),
    unit: unit.default(null),
    target: target.default(null),
    notesEnabled: z.boolean().default(false),
    // A habit is never created already archived.
    status: z.enum(['active', 'upcoming']).default('active'),
  })
  .refine(quantityIsComplete, {
    message: 'A quantity habit needs both a unit and a target',
    path: ['target'],
  })

export const updateHabitSchema = z.object({
  name: name.optional(),
  kind: z.enum([...habitKinds]).optional(),
  unit: unit.optional(),
  target: target.optional(),
  notesEnabled: z.boolean().optional(),
  status: z.enum([...habitStatuses]).optional(),
})

export const logEntrySchema = z.object({
  habitId: z.number().int().positive(),
  completed: z.boolean().optional(),
  value: z.number().nonnegative().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
})

export const logPayloadSchema = z.object({
  entries: z.array(logEntrySchema).max(100),
})
```

- [ ] **Step 3: Rewrite the habits routes**

Replace `server/routes/habits.ts`:

```ts
import { zValidator } from '@hono/zod-validator'
import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client'
import { habits, habitStatuses } from '../db/schema'
import { today } from '../lib/date'
import { createHabitSchema, updateHabitSchema } from '../validation'

export const habitsRoutes = new Hono()

habitsRoutes.get('/', c => {
  const status = c.req.query('status')
  if (status && !habitStatuses.includes(status as (typeof habitStatuses)[number])) {
    return c.json({ error: `Unknown status: ${status}` }, 400)
  }

  const query = db.select().from(habits).$dynamic()
  const rows = (status ? query.where(eq(habits.status, status as (typeof habitStatuses)[number])) : query)
    .orderBy(asc(habits.id))
    .all()

  return c.json({ habits: rows })
})

habitsRoutes.post('/', zValidator('json', createHabitSchema), c => {
  const input = c.req.valid('json')

  const created = db
    .insert(habits)
    .values({
      ...input,
      // Only an active habit has started its grace period (D-3).
      activatedAt: input.status === 'active' ? today() : null,
    })
    .returning()
    .get()

  return c.json({ habit: created }, 201)
})

habitsRoutes.patch('/:id', zValidator('json', updateHabitSchema), c => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return c.json({ error: 'Invalid habit id' }, 400)
  }

  const existing = db.select().from(habits).where(eq(habits.id, id)).get()
  if (!existing) {
    return c.json({ error: 'Habit not found' }, 404)
  }

  const input = c.req.valid('json')
  const becomingActive = input.status === 'active' && existing.status !== 'active'

  const updated = db
    .update(habits)
    .set({
      ...input,
      // Returning to active restarts the grace period (D-3).
      ...(becomingActive ? { activatedAt: today() } : {}),
    })
    .where(eq(habits.id, id))
    .returning()
    .get()

  return c.json({ habit: updated })
})
```

- [ ] **Step 4: Extract the app from the listener**

Create `server/app.ts`:

```ts
import { Hono } from 'hono'
import { habitsRoutes } from './routes/habits'

/**
 * Builds the API. Kept separate from index.ts so tests can call app.request()
 * without binding a port.
 */
export function createApp() {
  const app = new Hono()

  app.get('/api/health', c => c.json({ ok: true }))
  app.route('/api/habits', habitsRoutes)

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Something went wrong' }, 500)
  })

  return app
}
```

Replace `server/index.ts`:

```ts
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { DB_PATH } from './db/client'

const port = Number(process.env.PORT ?? 5174)

serve({ fetch: createApp().fetch, port }, info => {
  console.log(`API listening on http://localhost:${info.port}`)
  console.log(`SQLite at ${DB_PATH}`)
})
```

- [ ] **Step 5: Write the route test**

Create `server/routes/habits.spec.ts`. Every import is dynamic and happens *after*
`DATABASE_PATH` is set, because `db/client.ts` opens its connection at module load:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let app: { request: (path: string, init?: RequestInit) => Promise<Response> }
let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'habit-routes-'))
  process.env.DATABASE_PATH = join(dir, 'test.db')

  const { db } = await import('../db/client')
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  migrate(db, { migrationsFolder: './drizzle' })

  app = (await import('../app')).createApp()
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function patch(path: string, body: unknown) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/habits', () => {
  it('creates a binary habit and starts its grace period', async () => {
    const response = await post('/api/habits', { name: 'Exercise', notesEnabled: true })
    expect(response.status).toBe(201)

    const { habit } = await response.json()
    expect(habit.name).toBe('Exercise')
    expect(habit.kind).toBe('binary')
    expect(habit.status).toBe('active')
    expect(habit.activatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('leaves an upcoming habit unactivated', async () => {
    const { habit } = await (await post('/api/habits', { name: 'Journal', status: 'upcoming' })).json()
    expect(habit.status).toBe('upcoming')
    expect(habit.activatedAt).toBeNull()
  })

  it('rejects a quantity habit with no target', async () => {
    const response = await post('/api/habits', { name: 'Meditation', kind: 'quantity', unit: 'minutes' })
    expect(response.status).toBe(400)
  })

  it('rejects an empty name', async () => {
    expect((await post('/api/habits', { name: '   ' })).status).toBe(400)
  })

  it('rejects a negative target', async () => {
    const response = await post('/api/habits', {
      name: 'Meditation', kind: 'quantity', unit: 'minutes', target: -5,
    })
    expect(response.status).toBe(400)
  })
})

describe('GET /api/habits', () => {
  it('filters by status', async () => {
    const response = await app.request('/api/habits?status=upcoming')
    const { habits } = await response.json()
    expect(habits.every((h: { status: string }) => h.status === 'upcoming')).toBe(true)
    expect(habits.length).toBeGreaterThan(0)
  })

  it('returns every habit when no status is given', async () => {
    const { habits } = await (await app.request('/api/habits')).json()
    const statuses = new Set(habits.map((h: { status: string }) => h.status))
    expect(statuses.size).toBeGreaterThan(1)
  })

  it('rejects an unknown status', async () => {
    expect((await app.request('/api/habits?status=banana')).status).toBe(400)
  })
})

describe('PATCH /api/habits/:id', () => {
  it('activating an upcoming habit sets activatedAt (D-3)', async () => {
    const { habit } = await (await post('/api/habits', { name: 'Stretch', status: 'upcoming' })).json()
    expect(habit.activatedAt).toBeNull()

    const { habit: activated } = await (await patch(`/api/habits/${habit.id}`, { status: 'active' })).json()
    expect(activated.status).toBe('active')
    expect(activated.activatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('changes a target without touching activatedAt', async () => {
    const { habit } = await (await post('/api/habits', {
      name: 'Meditation', kind: 'quantity', unit: 'minutes', target: 5,
    })).json()

    const { habit: updated } = await (await patch(`/api/habits/${habit.id}`, { target: 10 })).json()
    expect(updated.target).toBe(10)
    expect(updated.activatedAt).toBe(habit.activatedAt)
  })

  it('404s for a habit that does not exist', async () => {
    expect((await patch('/api/habits/9999', { name: 'Nope' })).status).toBe(404)
  })
})
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run server/routes/habits.spec.ts`
Expected: PASS, 11 tests.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck && pnpm test
git add server/validation.ts server/app.ts server/index.ts server/routes/habits.ts server/routes/habits.spec.ts package.json pnpm-lock.yaml
git commit -m "feat(api): habit CRUD with Zod validation and lifecycle rules

Extracts the Hono app from the listener so routes are testable without a
port. Activating a habit stamps activatedAt, restarting its grace period."
```

---

### Task 7: Dashboard and log routes

The two endpoints the screens actually call.

**Files:**
- Create: `server/routes/dashboard.ts`
- Create: `server/routes/log.ts`
- Modify: `server/app.ts` (mount both)
- Test: `server/routes/log.spec.ts`

**Interfaces:**
- Consumes: `buildDashboard` from `server/lib/dashboard.ts`; `previousDay`, `startOfWeek`, `today`, `isValidDateKey` from `server/lib/date.ts`; `logPayloadSchema` from `server/validation.ts`
- Produces: `dashboardRoutes` (`GET /`), `logRoutes` (`GET /:date`, `PUT /:date`)

> **Refinement of the spec:** `GET /api/log/:date` returns active habits *plus* any
> non-archived habit that already has an entry on that date. Without the second clause a habit
> you demoted to upcoming would show its old squares on the dashboard but be uneditable when
> you tapped one, which contradicts D-5.

- [ ] **Step 1: Write the dashboard route**

Create `server/routes/dashboard.ts`:

```ts
import { asc, eq, gte } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client'
import { habitEntries, habits } from '../db/schema'
import { WINDOW_DAYS } from '../lib/consistency'
import { buildDashboard } from '../lib/dashboard'
import { lastNDays, previousDay, startOfWeek, today } from '../lib/date'

export const dashboardRoutes = new Hono()

const DEFAULT_WEEKS = 15
const MAX_WEEKS = 53

dashboardRoutes.get('/', c => {
  const requested = Number(c.req.query('weeks') ?? DEFAULT_WEEKS)
  const weeks = Number.isFinite(requested)
    ? Math.min(MAX_WEEKS, Math.max(1, Math.trunc(requested)))
    : DEFAULT_WEEKS

  const todayKey = today()
  let from = todayKey
  for (let i = 0; i < weeks * 7; i++) from = previousDay(from)
  // Grids start on a week boundary so columns are whole weeks.
  from = startOfWeek(from)

  const active = db
    .select()
    .from(habits)
    .where(eq(habits.status, 'active'))
    .orderBy(asc(habits.id))
    .all()

  // Health and rate need the full consistency window even when the grid is
  // short, so never fetch less than WINDOW_DAYS of entries.
  const windowStart = lastNDays(WINDOW_DAYS, todayKey)[0]!
  const entriesFrom = from < windowStart ? from : windowStart

  const entries = db.select().from(habitEntries).where(gte(habitEntries.date, entriesFrom)).all()

  return c.json(buildDashboard(active, entries, from, todayKey))
})
```

- [ ] **Step 2: Write the log route**

Create `server/routes/log.ts`:

```ts
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client'
import { habitEntries, habits, type Habit } from '../db/schema'
import { isValidDateKey, today } from '../lib/date'
import { logPayloadSchema } from '../validation'

export const logRoutes = new Hono()

/**
 * Habits loggable on a given day: everything currently active, plus any
 * non-archived habit that already has an entry that day, so a demoted habit's
 * past days stay editable (D-5).
 */
function habitsForDate(date: string): Habit[] {
  const active = db.select().from(habits).where(eq(habits.status, 'active')).all()

  const loggedIds = db
    .select({ habitId: habitEntries.habitId })
    .from(habitEntries)
    .where(eq(habitEntries.date, date))
    .all()
    .map(row => row.habitId)

  const extras = loggedIds.length
    ? db
        .select()
        .from(habits)
        .where(and(inArray(habits.id, loggedIds), ne(habits.status, 'archived')))
        .all()
    : []

  const byId = new Map<number, Habit>()
  for (const habit of [...active, ...extras]) byId.set(habit.id, habit)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

function dayPayload(date: string) {
  const forDate = habitsForDate(date)
  const entries = db.select().from(habitEntries).where(eq(habitEntries.date, date)).all()
  const byHabit = new Map(entries.map(entry => [entry.habitId, entry]))

  return {
    date,
    isToday: date === today(),
    habits: forDate.map(habit => {
      const entry = byHabit.get(habit.id)
      return {
        id: habit.id,
        name: habit.name,
        kind: habit.kind,
        unit: habit.unit,
        target: habit.target,
        notesEnabled: habit.notesEnabled,
        entry: entry
          ? { completed: entry.completed, value: entry.value, note: entry.note }
          : null,
      }
    }),
  }
}

logRoutes.get('/:date', c => {
  const date = c.req.param('date')
  if (!isValidDateKey(date)) return c.json({ error: 'Expected a date as YYYY-MM-DD' }, 400)
  if (date > today()) return c.json({ error: 'Cannot log a future day' }, 400)

  return c.json(dayPayload(date))
})

logRoutes.put('/:date', zValidator('json', logPayloadSchema), c => {
  const date = c.req.param('date')
  if (!isValidDateKey(date)) return c.json({ error: 'Expected a date as YYYY-MM-DD' }, 400)
  if (date > today()) return c.json({ error: 'Cannot log a future day' }, 400)

  const { entries } = c.req.valid('json')

  for (const input of entries) {
    const habit = db.select().from(habits).where(eq(habits.id, input.habitId)).get()
    if (!habit) return c.json({ error: `Habit ${input.habitId} not found` }, 404)
    if (habit.status === 'archived') {
      return c.json({ error: `Habit ${input.habitId} is archived` }, 400)
    }

    const isQuantity = habit.kind === 'quantity'
    const value = isQuantity ? (input.value ?? 0) : null
    // The server decides what counts as done — never the client (D-1).
    const completed = isQuantity ? value! > 0 : Boolean(input.completed)

    // An omitted note keeps whatever is stored, so turning notesEnabled off
    // never destroys existing notes (D-6). Only an explicit note replaces one.
    const existing = db
      .select()
      .from(habitEntries)
      .where(and(eq(habitEntries.habitId, habit.id), eq(habitEntries.date, date)))
      .get()
    const note =
      input.note === undefined
        ? (existing?.note ?? null)
        : (input.note?.trim() ? input.note.trim() : null)

    db.insert(habitEntries)
      .values({ habitId: habit.id, date, completed, value, note })
      .onConflictDoUpdate({
        target: [habitEntries.habitId, habitEntries.date],
        set: { completed, value, note },
      })
      .run()
  }

  return c.json(dayPayload(date))
})
```

- [ ] **Step 3: Mount both in the app**

In `server/app.ts`, add the imports and two `app.route` lines:

```ts
import { dashboardRoutes } from './routes/dashboard'
import { logRoutes } from './routes/log'
```

```ts
  app.route('/api/dashboard', dashboardRoutes)
  app.route('/api/log', logRoutes)
```

- [ ] **Step 4: Write the log route test**

Create `server/routes/log.spec.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let app: { request: (path: string, init?: RequestInit) => Promise<Response> }
let dir: string
let todayKey: string
let exerciseId: number
let meditationId: number

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'habit-log-'))
  process.env.DATABASE_PATH = join(dir, 'test.db')

  const { db } = await import('../db/client')
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  migrate(db, { migrationsFolder: './drizzle' })

  todayKey = (await import('../lib/date')).today()
  app = (await import('../app')).createApp()

  const create = async (body: unknown) => {
    const response = await app.request('/api/habits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await response.json()).habit.id as number
  }

  exerciseId = await create({ name: 'Exercise', notesEnabled: true })
  meditationId = await create({ name: 'Meditation', kind: 'quantity', unit: 'minutes', target: 10 })
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function put(date: string, entries: unknown[]) {
  return app.request(`/api/log/${date}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries }),
  })
}

describe('GET /api/log/:date', () => {
  it('returns every active habit with a null entry when nothing is logged', async () => {
    const body = await (await app.request('/api/log/2026-01-05')).json()
    expect(body.date).toBe('2026-01-05')
    expect(body.isToday).toBe(false)
    expect(body.habits).toHaveLength(2)
    expect(body.habits.every((h: { entry: unknown }) => h.entry === null)).toBe(true)
  })

  it('marks today as today', async () => {
    const body = await (await app.request(`/api/log/${todayKey}`)).json()
    expect(body.isToday).toBe(true)
  })

  it('rejects a malformed date', async () => {
    expect((await app.request('/api/log/2026-9-5')).status).toBe(400)
  })

  it('rejects a date that does not exist', async () => {
    expect((await app.request('/api/log/2026-02-30')).status).toBe(400)
  })

  it('rejects a future date', async () => {
    expect((await app.request('/api/log/2099-01-01')).status).toBe(400)
  })
})

describe('PUT /api/log/:date', () => {
  it('saves a binary habit with a note', async () => {
    const response = await put('2026-01-06', [
      { habitId: exerciseId, completed: true, note: 'squats, 5k' },
    ])
    expect(response.status).toBe(200)

    const body = await response.json()
    const exercise = body.habits.find((h: { id: number }) => h.id === exerciseId)
    expect(exercise.entry).toEqual({ completed: true, value: null, note: 'squats, 5k' })
  })

  it('derives completed from the value for a quantity habit (D-1)', async () => {
    const body = await (await put('2026-01-07', [{ habitId: meditationId, value: 5, completed: false }])).json()
    const meditation = body.habits.find((h: { id: number }) => h.id === meditationId)
    // Client said completed:false; the server trusts the value instead.
    expect(meditation.entry.completed).toBe(true)
    expect(meditation.entry.value).toBe(5)
  })

  it('treats a logged zero as not completed', async () => {
    const body = await (await put('2026-01-08', [{ habitId: meditationId, value: 0 }])).json()
    const meditation = body.habits.find((h: { id: number }) => h.id === meditationId)
    expect(meditation.entry.completed).toBe(false)
  })

  it('overwrites an existing day rather than duplicating it', async () => {
    await put('2026-01-09', [{ habitId: meditationId, value: 5 }])
    const body = await (await put('2026-01-09', [{ habitId: meditationId, value: 30 }])).json()
    const meditation = body.habits.find((h: { id: number }) => h.id === meditationId)
    expect(meditation.entry.value).toBe(30)
  })

  it('leaves habits absent from the body untouched', async () => {
    await put('2026-01-10', [{ habitId: exerciseId, completed: true }])
    await put('2026-01-10', [{ habitId: meditationId, value: 10 }])

    const body = await (await app.request('/api/log/2026-01-10')).json()
    const exercise = body.habits.find((h: { id: number }) => h.id === exerciseId)
    expect(exercise.entry.completed).toBe(true)
  })

  it('stores a blank note as null', async () => {
    const body = await (await put('2026-01-11', [{ habitId: exerciseId, completed: true, note: '   ' }])).json()
    const exercise = body.habits.find((h: { id: number }) => h.id === exerciseId)
    expect(exercise.entry.note).toBeNull()
  })

  it('rejects a future date', async () => {
    expect((await put('2099-01-01', [{ habitId: exerciseId, completed: true }])).status).toBe(400)
  })

  it('404s for a habit that does not exist', async () => {
    expect((await put('2026-01-12', [{ habitId: 9999, completed: true }])).status).toBe(404)
  })

  it('rejects entries for an archived habit', async () => {
    const created = await (await app.request('/api/habits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Old habit' }),
    })).json()

    await app.request(`/api/habits/${created.habit.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    })

    const response = await put('2026-01-13', [{ habitId: created.habit.id, completed: true }])
    expect(response.status).toBe(400)
  })
})

describe('GET /api/dashboard', () => {
  it('returns a dense grid for every active habit', async () => {
    const body = await (await app.request('/api/dashboard?weeks=2')).json()
    expect(body.today).toBe(todayKey)
    expect(body.habits.length).toBeGreaterThanOrEqual(2)

    for (const habit of body.habits) {
      expect(habit.days[0].date).toBe(body.from)
      expect(habit.days.at(-1).date).toBe(todayKey)
      expect(habit.days.every((d: { level: number }) => d.level >= 0 && d.level <= 4)).toBe(true)
    }
  })

  it('clamps an absurd weeks value', async () => {
    const body = await (await app.request('/api/dashboard?weeks=9999')).json()
    expect(body.habits[0].days.length).toBeLessThanOrEqual(53 * 7 + 7)
  })

  it('falls back to the default for a non-numeric weeks value', async () => {
    const response = await app.request('/api/dashboard?weeks=banana')
    expect(response.status).toBe(200)
  })
})
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run server/routes/log.spec.ts`
Expected: PASS, 18 tests.

- [ ] **Step 6: Verify against the real dev server**

```bash
pnpm dev
```

In another terminal:

```bash
curl -s localhost:5174/api/dashboard?weeks=2 | head -c 400; echo
curl -s -X PUT localhost:5174/api/log/$(date +%F) -H 'content-type: application/json' -d '{"entries":[{"habitId":3,"value":5}]}' | head -c 300
```

Expected: a dashboard payload with four habits, then a log payload showing Meditation at
`value: 5`, `completed: true`.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck && pnpm test
git add server/routes/dashboard.ts server/routes/log.ts server/routes/log.spec.ts server/app.ts
git commit -m "feat(api): dashboard grids and day logging

The server derives completed from the logged value for quantity habits
and refuses future days. Demoted habits stay editable on days they already
have entries, so tapping an old square always works."
```

---

### Task 8: Web API client and shadcn components

Types mirroring the server payloads, plus the UI primitives the three screens need.

**Files:**
- Rewrite: `src/lib/api.ts`
- Create (via CLI): `src/components/ui/{input,textarea,label,badge,select,alert-dialog}/*`

**Interfaces:**
- Consumes: the routes from Tasks 6–7
- Produces: `HabitKind`, `HabitStatus`, `Health`, `ActivityLevel`, `Habit`, `DashboardDay`, `DashboardHabit`, `DashboardWarning`, `DashboardResponse`, `LogEntry`, `LogHabit`, `LogResponse`, `LogEntryInput`, `CreateHabitInput`, `UpdateHabitInput`, and the functions `fetchDashboard`, `fetchLog`, `saveLog`, `fetchHabits`, `createHabit`, `updateHabit`

- [ ] **Step 1: Add the shadcn components**

```bash
npx shadcn-vue@1.0.3 add input textarea label badge select alert-dialog --yes --overwrite
```

Expected: files created under `src/components/ui/`. If the CLI reports an invalid
`components.json`, confirm `tsconfig.json` still carries the `@/*` path entry — the CLI reads
the root tsconfig, not `tsconfig.app.json`.

- [ ] **Step 2: Rewrite the API client**

Replace `src/lib/api.ts`:

```ts
export type HabitKind = 'binary' | 'quantity'
export type HabitStatus = 'active' | 'upcoming' | 'archived'
export type Health = 'new' | 'struggling' | 'steady' | 'consistent'
export type ActivityLevel = 0 | 1 | 2 | 3 | 4

export interface Habit {
  id: number
  name: string
  kind: HabitKind
  unit: string | null
  target: number | null
  notesEnabled: boolean
  status: HabitStatus
  activatedAt: string | null
  createdAt: string
}

export interface DashboardDay {
  date: string
  completed: boolean
  value: number | null
  note: string | null
  level: ActivityLevel
}

export interface DashboardHabit {
  id: number
  name: string
  kind: HabitKind
  unit: string | null
  target: number | null
  notesEnabled: boolean
  activatedAt: string | null
  health: Health
  streak: number
  rate: number
  days: DashboardDay[]
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

export interface LogEntry {
  completed: boolean
  value: number | null
  note: string | null
}

export interface LogHabit {
  id: number
  name: string
  kind: HabitKind
  unit: string | null
  target: number | null
  notesEnabled: boolean
  entry: LogEntry | null
}

export interface LogResponse {
  date: string
  isToday: boolean
  habits: LogHabit[]
}

export interface LogEntryInput {
  habitId: number
  completed?: boolean
  value?: number | null
  note?: string | null
}

export interface CreateHabitInput {
  name: string
  kind?: HabitKind
  unit?: string | null
  target?: number | null
  notesEnabled?: boolean
  status?: 'active' | 'upcoming'
}

export type UpdateHabitInput = Partial<Omit<Habit, 'id' | 'createdAt' | 'activatedAt'>>

/** Surfaces the server's own message so the UI can say what actually went wrong. */
async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null)
    throw new Error(message ?? `Request failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

function send(path: string, method: string, body: unknown) {
  return fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function fetchDashboard(weeks = 15): Promise<DashboardResponse> {
  return json<DashboardResponse>(await fetch(`/api/dashboard?weeks=${weeks}`))
}

export async function fetchLog(date: string): Promise<LogResponse> {
  return json<LogResponse>(await fetch(`/api/log/${date}`))
}

export async function saveLog(date: string, entries: LogEntryInput[]): Promise<LogResponse> {
  return json<LogResponse>(await send(`/api/log/${date}`, 'PUT', { entries }))
}

export async function fetchHabits(status?: HabitStatus): Promise<Habit[]> {
  const query = status ? `?status=${status}` : ''
  const body = await json<{ habits: Habit[] }>(await fetch(`/api/habits${query}`))
  return body.habits
}

export async function createHabit(input: CreateHabitInput): Promise<Habit> {
  const body = await json<{ habit: Habit }>(await send('/api/habits', 'POST', input))
  return body.habit
}

export async function updateHabit(id: number, input: UpdateHabitInput): Promise<Habit> {
  const body = await json<{ habit: Habit }>(await send(`/api/habits/${id}`, 'PATCH', input))
  return body.habit
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add src/lib/api.ts src/components/ui package.json pnpm-lock.yaml
git commit -m "feat(web): typed API client and the UI primitives the screens need"
```

---

### Task 9: ActivityGrid and HealthPill

The two presentational pieces the dashboard is built from.

**Files:**
- Create: `src/components/ActivityGrid.vue`, `src/components/ActivityGrid.scss`
- Create: `src/components/HealthPill.vue`, `src/components/HealthPill.scss`

**Interfaces:**
- Consumes: `DashboardDay`, `Health`, `HabitKind` from `@/lib/api`
- Produces: `<ActivityGrid :days="days" :unit="unit" />` and `<HealthPill :health="health" :rate="rate" />`

- [ ] **Step 1: Write the grid**

Create `src/components/ActivityGrid.vue`. Each square is a link, so tapping any day opens it
for editing and keyboard users get it for free:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardDay } from '@/lib/api'

const props = defineProps<{ days: DashboardDay[], unit: string | null }>()

/**
 * Columns of seven, oldest first. The server already starts the range on a
 * Monday, so every column is a whole week.
 */
const weeks = computed(() => {
  const chunks: DashboardDay[][] = []
  for (let i = 0; i < props.days.length; i += 7) {
    chunks.push(props.days.slice(i, i + 7))
  }
  return chunks
})

function describe(day: DashboardDay): string {
  if (!day.completed) return `${day.date} — nothing logged`
  if (day.value !== null) return `${day.date} — ${day.value} ${props.unit ?? ''}`.trim()
  return `${day.date} — done`
}
</script>

<template>
  <div class="activity-grid">
    <div class="activity-grid__scroll">
      <div class="activity-grid__weeks">
        <div v-for="(week, index) in weeks" :key="index" class="activity-grid__week">
          <RouterLink
            v-for="day in week"
            :key="day.date"
            :to="{ path: '/log', query: { date: day.date } }"
            class="activity-grid__day"
            :class="`is-level-${day.level}`"
            :title="describe(day)"
            :aria-label="describe(day)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped src="./ActivityGrid.scss"></style>
```

- [ ] **Step 2: Write the grid styles**

Create `src/components/ActivityGrid.scss`. Levels use the primary token directly, because
Tailwind's `/25` opacity modifiers do not work against a bare `hsl(var(--primary))` colour
definition:

```scss
.activity-grid {
  &__scroll {
    @apply overflow-x-auto pb-1;
  }

  &__weeks {
    @apply flex gap-1 w-max;
  }

  &__week {
    @apply grid gap-1;
    grid-template-rows: repeat(7, minmax(0, 1fr));
  }

  &__day {
    @apply block rounded-sm transition-colors;
    width: 0.75rem;
    height: 0.75rem;
    background-color: hsl(var(--muted));

    &:hover {
      @apply ring-1 ring-ring;
    }

    &:focus-visible {
      @apply outline-none ring-2 ring-ring;
    }

    &.is-level-1 { background-color: hsl(var(--primary) / 0.25); }
    &.is-level-2 { background-color: hsl(var(--primary) / 0.5); }
    &.is-level-3 { background-color: hsl(var(--primary) / 0.75); }
    &.is-level-4 { background-color: hsl(var(--primary)); }
  }
}
```

- [ ] **Step 3: Write the health pill**

Create `src/components/HealthPill.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { Health } from '@/lib/api'

const props = defineProps<{ health: Health, rate: number }>()

const LABELS: Record<Health, string> = {
  new: 'Settling in',
  struggling: 'Slipping',
  steady: 'Steady',
  consistent: 'Consistent',
}

const label = computed(() => LABELS[props.health])
const percent = computed(() => `${Math.round(props.rate * 100)}%`)
</script>

<template>
  <span class="health-pill" :class="`is-${health}`">
    <span class="health-pill__label">{{ label }}</span>
    <span v-if="health !== 'new'" class="health-pill__rate">{{ percent }}</span>
  </span>
</template>

<style lang="scss" scoped src="./HealthPill.scss"></style>
```

Create `src/components/HealthPill.scss`:

```scss
.health-pill {
  @apply inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium;

  &__rate {
    @apply tabular-nums opacity-70;
  }

  &.is-new {
    @apply border-border bg-muted text-muted-foreground;
  }

  &.is-struggling {
    @apply border-destructive/40 text-destructive;
    background-color: hsl(var(--destructive) / 0.1);
  }

  &.is-steady {
    @apply border-border bg-secondary text-secondary-foreground;
  }

  &.is-consistent {
    @apply border-primary/30 text-primary;
    background-color: hsl(var(--primary) / 0.1);
  }
}
```

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck
git add src/components/ActivityGrid.vue src/components/ActivityGrid.scss src/components/HealthPill.vue src/components/HealthPill.scss
git commit -m "feat(web): activity grid and health pill components"
```

---

### Task 10: Dashboard page

**Files:**
- Rewrite: `src/pages/index.vue`, `src/pages/index.scss`

**Interfaces:**
- Consumes: `fetchDashboard`, `updateHabit`, `DashboardResponse` from `@/lib/api`; `ActivityGrid`, `HealthPill`
- Produces: the `/` route

- [ ] **Step 1: Write the page**

Replace `src/pages/index.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ActivityGrid from '@/components/ActivityGrid.vue'
import HealthPill from '@/components/HealthPill.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchDashboard, updateHabit, type DashboardResponse } from '@/lib/api'

const data = ref<DashboardResponse | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const parkingId = ref<number | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    data.value = await fetchDashboard()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not reach the API.'
  } finally {
    loading.value = false
  }
}

async function park(habitId: number) {
  parkingId.value = habitId
  try {
    await updateHabit(habitId, { status: 'upcoming' })
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not move that habit.'
  } finally {
    parkingId.value = null
  }
}

function streakLabel(streak: number) {
  return streak === 1 ? '1 day streak' : `${streak} day streak`
}

onMounted(load)
</script>

<template>
  <div class="dashboard">
    <p v-if="loading" class="dashboard__state">Loading…</p>

    <div v-else-if="error" class="dashboard__state dashboard__state--error">
      <p>{{ error }}</p>
      <Button variant="outline" size="sm" @click="load">Try again</Button>
    </div>

    <template v-else-if="data">
      <section v-if="data.warnings.length" class="dashboard__warnings">
        <h2 class="dashboard__warnings-title">Slipping</h2>
        <p class="dashboard__warnings-lead">
          These aren't sticking. Park them until the rest are consistent.
        </p>
        <ul class="dashboard__warnings-list">
          <li v-for="warning in data.warnings" :key="warning.habitId" class="dashboard__warning">
            <span class="dashboard__warning-name">{{ warning.name }}</span>
            <span class="dashboard__warning-rate">{{ Math.round(warning.rate * 100) }}% of the last 14 days</span>
            <Button
              variant="outline"
              size="sm"
              :disabled="parkingId === warning.habitId"
              @click="park(warning.habitId)"
            >
              Move to upcoming
            </Button>
          </li>
        </ul>
      </section>

      <p v-if="data.habits.length === 0" class="dashboard__state">
        No active habits. Add one on the Habits screen.
      </p>

      <Card v-for="habit in data.habits" :key="habit.id" class="dashboard__habit">
        <CardHeader class="dashboard__habit-header">
          <CardTitle>{{ habit.name }}</CardTitle>
          <HealthPill :health="habit.health" :rate="habit.rate" />
        </CardHeader>
        <CardContent>
          <p class="dashboard__habit-meta">
            {{ streakLabel(habit.streak) }}
            <template v-if="habit.kind === 'quantity'">
              · target {{ habit.target }} {{ habit.unit }}
            </template>
          </p>
          <ActivityGrid :days="habit.days" :unit="habit.unit" />
        </CardContent>
      </Card>
    </template>
  </div>
</template>

<style lang="scss" scoped src="./index.scss"></style>
```

- [ ] **Step 2: Write the styles**

Replace `src/pages/index.scss`:

```scss
.dashboard {
  @apply mx-auto flex w-full max-w-3xl flex-col gap-4;

  &__state {
    @apply py-6 text-sm text-muted-foreground;

    &--error {
      @apply flex flex-col items-start gap-3 text-destructive;
    }
  }

  &__warnings {
    @apply rounded-lg border p-4;
    border-color: hsl(var(--destructive) / 0.4);
    background-color: hsl(var(--destructive) / 0.06);
  }

  &__warnings-title {
    @apply text-sm font-semibold text-destructive;
  }

  &__warnings-lead {
    @apply mt-1 text-sm text-muted-foreground;
  }

  &__warnings-list {
    @apply mt-3 flex flex-col gap-2;
  }

  &__warning {
    @apply flex flex-wrap items-center gap-x-3 gap-y-2;
  }

  &__warning-name {
    @apply text-sm font-medium;
  }

  &__warning-rate {
    @apply flex-1 text-sm tabular-nums text-muted-foreground;
  }

  &__habit-header {
    @apply flex-row items-center justify-between gap-3 space-y-0;
  }

  &__habit-meta {
    @apply mb-3 text-sm tabular-nums text-muted-foreground;
  }
}
```

- [ ] **Step 3: Verify in the browser**

With `pnpm dev` running, open `http://localhost:5173`. Expected: four habit cards, each with a
"Settling in" pill (they were seeded today, so all are inside the grace period) and an empty
grid. No console errors.

- [ ] **Step 4: Commit**

```bash
pnpm typecheck
git add src/pages/index.vue src/pages/index.scss
git commit -m "feat(web): dashboard with activity grids and slipping-habit warnings"
```

---

### Task 11: Log page

**Files:**
- Create: `src/pages/log.vue`, `src/pages/log.scss`
- Create: `src/components/LogHabitCard.vue`, `src/components/LogHabitCard.scss`
- Delete: `src/components/HabitItem.vue`, `src/components/HabitItem.scss`

**Interfaces:**
- Consumes: `fetchLog`, `saveLog`, `LogHabit`, `LogEntryInput` from `@/lib/api`
- Produces: the `/log` route, reading `?date=YYYY-MM-DD`

- [ ] **Step 1: Write the per-habit card**

Create `src/components/LogHabitCard.vue`. It owns one habit's draft state and emits changes up:

```vue
<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { LogHabit } from '@/lib/api'

defineProps<{
  habit: LogHabit
  completed: boolean
  value: number | null
  note: string
}>()

defineEmits<{
  'update:completed': [value: boolean]
  'update:value': [value: number | null]
  'update:note': [value: string]
}>()
</script>

<template>
  <div class="log-card">
    <div class="log-card__head">
      <Checkbox
        v-if="habit.kind === 'binary'"
        :id="`done-${habit.id}`"
        :model-value="completed"
        @update:model-value="$emit('update:completed', Boolean($event))"
      />
      <Label :for="habit.kind === 'binary' ? `done-${habit.id}` : `value-${habit.id}`" class="log-card__name">
        {{ habit.name }}
      </Label>
    </div>

    <div v-if="habit.kind === 'quantity'" class="log-card__quantity">
      <Input
        :id="`value-${habit.id}`"
        type="number"
        min="0"
        inputmode="numeric"
        :model-value="value ?? ''"
        class="log-card__input"
        @update:model-value="$emit('update:value', $event === '' ? null : Number($event))"
      />
      <span class="log-card__unit">{{ habit.unit }}</span>
      <Button
        v-if="habit.target !== null"
        type="button"
        variant="outline"
        size="sm"
        @click="$emit('update:value', habit.target)"
      >
        {{ habit.target }}
      </Button>
    </div>

    <Textarea
      v-if="habit.notesEnabled"
      :model-value="note"
      placeholder="What did you do?"
      class="log-card__note"
      @update:model-value="$emit('update:note', String($event))"
    />
  </div>
</template>

<style lang="scss" scoped src="./LogHabitCard.scss"></style>
```

Create `src/components/LogHabitCard.scss`:

```scss
.log-card {
  @apply flex flex-col gap-3 rounded-lg border p-4;

  &__head {
    @apply flex items-center gap-3;
  }

  &__name {
    @apply cursor-pointer text-sm font-medium;
  }

  &__quantity {
    @apply flex items-center gap-2;
  }

  &__input {
    @apply w-24 tabular-nums;
  }

  &__unit {
    @apply text-sm text-muted-foreground;
  }

  &__note {
    @apply min-h-20;
  }
}
```

- [ ] **Step 2: Write the log page**

Create `src/pages/log.vue`:

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LogHabitCard from '@/components/LogHabitCard.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchLog, saveLog, type LogEntryInput, type LogHabit } from '@/lib/api'

interface Draft {
  completed: boolean
  value: number | null
  note: string
}

const route = useRoute()
const router = useRouter()

const habits = ref<LogHabit[]>([])
const drafts = ref<Record<number, Draft>>({})
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref<string | null>(null)
const maxDate = ref('')

const date = computed(() => {
  const fromQuery = route.query.date
  return typeof fromQuery === 'string' ? fromQuery : ''
})

function toDrafts(list: LogHabit[]): Record<number, Draft> {
  return Object.fromEntries(
    list.map(habit => [
      habit.id,
      {
        completed: habit.entry?.completed ?? false,
        value: habit.entry?.value ?? null,
        note: habit.entry?.note ?? '',
      },
    ]),
  )
}

async function load(target: string) {
  loading.value = true
  error.value = null
  saved.value = false
  try {
    const data = await fetchLog(target)
    habits.value = data.habits
    drafts.value = toDrafts(data.habits)
    if (!maxDate.value && data.isToday) maxDate.value = data.date
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load that day.'
  } finally {
    loading.value = false
  }
}

function goTo(target: string) {
  router.replace({ path: '/log', query: { date: target } })
}

function shift(days: number) {
  const [year, month, day] = date.value.split('-').map(Number)
  const moved = new Date(year!, month! - 1, day! + days)
  const key = `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, '0')}-${String(moved.getDate()).padStart(2, '0')}`
  goTo(key)
}

async function save() {
  saving.value = true
  error.value = null
  try {
    const entries: LogEntryInput[] = habits.value.map(habit => {
      const draft = drafts.value[habit.id]!
      // Omit `note` entirely for habits without notes — sending null would
      // erase a note written while the flag was on (D-6).
      return {
        habitId: habit.id,
        completed: draft.completed,
        value: habit.kind === 'quantity' ? draft.value : null,
        ...(habit.notesEnabled ? { note: draft.note } : {}),
      }
    })
    const data = await saveLog(date.value, entries)
    habits.value = data.habits
    drafts.value = toDrafts(data.habits)
    saved.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save that day.'
  } finally {
    saving.value = false
  }
}

watch(
  date,
  async target => {
    if (!target) {
      // No date in the query — land on today, formatted from local calendar
      // parts rather than a locale string or toISOString (which is UTC).
      const now = new Date()
      const guess = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const data = await fetchLog(guess)
      goTo(data.date)
      return
    }
    await load(target)
  },
  { immediate: true },
)
</script>

<template>
  <div class="log">
    <header class="log__header">
      <Button variant="outline" size="sm" @click="shift(-1)">Previous</Button>
      <Input
        type="date"
        :model-value="date"
        :max="maxDate || undefined"
        class="log__date"
        @update:model-value="goTo(String($event))"
      />
      <Button variant="outline" size="sm" :disabled="date >= maxDate" @click="shift(1)">Next</Button>
    </header>

    <p v-if="loading" class="log__state">Loading…</p>

    <p v-else-if="error" class="log__state log__state--error">{{ error }}</p>

    <template v-else>
      <div class="log__list">
        <LogHabitCard
          v-for="habit in habits"
          :key="habit.id"
          :habit="habit"
          :completed="drafts[habit.id]!.completed"
          :value="drafts[habit.id]!.value"
          :note="drafts[habit.id]!.note"
          @update:completed="drafts[habit.id]!.completed = $event"
          @update:value="drafts[habit.id]!.value = $event"
          @update:note="drafts[habit.id]!.note = $event"
        />
      </div>

      <footer class="log__footer">
        <Button :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save day' }}</Button>
        <span v-if="saved" class="log__saved">Saved</span>
      </footer>
    </template>
  </div>
</template>

<style lang="scss" scoped src="./log.scss"></style>
```

Create `src/pages/log.scss`:

```scss
.log {
  @apply mx-auto flex w-full max-w-xl flex-col gap-4;

  &__header {
    @apply flex items-center gap-2;
  }

  &__date {
    @apply flex-1 tabular-nums;
  }

  &__list {
    @apply flex flex-col gap-3;
  }

  &__footer {
    @apply flex items-center gap-3;
  }

  &__saved {
    @apply text-sm text-muted-foreground;
  }

  &__state {
    @apply py-6 text-sm text-muted-foreground;

    &--error {
      @apply text-destructive;
    }
  }
}
```

- [ ] **Step 3: Delete the superseded component**

```bash
rm src/components/HabitItem.vue src/components/HabitItem.scss
```

- [ ] **Step 4: Verify in the browser**

Open `http://localhost:5173/log`. Expected: it redirects to `?date=<today>`, shows four cards —
Exercise with a checkbox and a note box, Code reading and Meditation with number inputs and a
target shortcut button, Record one video with a checkbox. Tick Exercise, type a note, set
Meditation to 5, press **Save day**, reload: the values come back. Then go to `/` — Meditation's
square for today is mid-shade and Exercise's is filled.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm test
git add src/pages/log.vue src/pages/log.scss src/components/LogHabitCard.vue src/components/LogHabitCard.scss
git rm --cached src/components/HabitItem.vue src/components/HabitItem.scss 2>/dev/null || true
git add -A
git commit -m "feat(web): log screen with backfill, amounts and notes"
```

---

### Task 12: Habits page

Active list, upcoming backlog, archive, and the add form — plus the soft nudge when activating while something is slipping.

**Files:**
- Create: `src/pages/habits.vue`, `src/pages/habits.scss`

**Interfaces:**
- Consumes: `fetchHabits`, `createHabit`, `updateHabit`, `fetchDashboard`, `Habit`, `Health` from `@/lib/api`; `HealthPill`
- Produces: the `/habits` route

- [ ] **Step 1: Write the page**

Create `src/pages/habits.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import HealthPill from '@/components/HealthPill.vue'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createHabit, fetchDashboard, fetchHabits, updateHabit,
  type Habit, type Health,
} from '@/lib/api'

const all = ref<Habit[]>([])
const health = ref<Record<number, { health: Health, rate: number }>>({})
const loading = ref(true)
const error = ref<string | null>(null)
const busyId = ref<number | null>(null)
const pendingActivation = ref<Habit | null>(null)

const form = ref({ name: '', isQuantity: false, unit: 'minutes', target: 10, notesEnabled: false })

const active = computed(() => all.value.filter(h => h.status === 'active'))
const upcoming = computed(() => all.value.filter(h => h.status === 'upcoming'))
const archived = computed(() => all.value.filter(h => h.status === 'archived'))

const consistentCount = computed(
  () => active.value.filter(h => health.value[h.id]?.health === 'consistent').length,
)

const strugglingNames = computed(
  () => active.value.filter(h => health.value[h.id]?.health === 'struggling').map(h => h.name),
)

async function load() {
  loading.value = true
  error.value = null
  try {
    const [habits, dashboard] = await Promise.all([fetchHabits(), fetchDashboard()])
    all.value = habits
    health.value = Object.fromEntries(
      dashboard.habits.map(h => [h.id, { health: h.health, rate: h.rate }]),
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load habits.'
  } finally {
    loading.value = false
  }
}

async function setStatus(habit: Habit, status: Habit['status']) {
  busyId.value = habit.id
  error.value = null
  try {
    await updateHabit(habit.id, { status })
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not update that habit.'
  } finally {
    busyId.value = null
  }
}

/** Activating while something is slipping asks first — but never refuses. */
function requestActivation(habit: Habit) {
  if (strugglingNames.value.length > 0) {
    pendingActivation.value = habit
    return
  }
  void setStatus(habit, 'active')
}

async function confirmActivation() {
  const habit = pendingActivation.value
  pendingActivation.value = null
  if (habit) await setStatus(habit, 'active')
}

async function submit(status: 'active' | 'upcoming') {
  error.value = null
  try {
    await createHabit({
      name: form.value.name,
      kind: form.value.isQuantity ? 'quantity' : 'binary',
      unit: form.value.isQuantity ? form.value.unit : null,
      target: form.value.isQuantity ? form.value.target : null,
      notesEnabled: form.value.notesEnabled,
      status,
    })
    form.value = { name: '', isQuantity: false, unit: 'minutes', target: 10, notesEnabled: false }
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not add that habit.'
  }
}

onMounted(load)
</script>

<template>
  <div class="habits">
    <p v-if="error" class="habits__error">{{ error }}</p>
    <p v-if="loading" class="habits__state">Loading…</p>

    <template v-else>
      <section class="habits__section">
        <header class="habits__section-head">
          <h2 class="habits__title">Active</h2>
          <span class="habits__count">{{ consistentCount }} of {{ active.length }} consistent</span>
        </header>

        <p v-if="active.length === 0" class="habits__state">Nothing active yet.</p>

        <ul class="habits__list">
          <li v-for="habit in active" :key="habit.id" class="habits__row">
            <span class="habits__name">{{ habit.name }}</span>
            <HealthPill
              v-if="health[habit.id]"
              :health="health[habit.id]!.health"
              :rate="health[habit.id]!.rate"
            />
            <Button variant="outline" size="sm" :disabled="busyId === habit.id" @click="setStatus(habit, 'upcoming')">
              Park
            </Button>
            <Button variant="ghost" size="sm" :disabled="busyId === habit.id" @click="setStatus(habit, 'archived')">
              Archive
            </Button>
          </li>
        </ul>
      </section>

      <section class="habits__section">
        <h2 class="habits__title">Upcoming</h2>
        <p v-if="upcoming.length === 0" class="habits__state">
          Nothing queued. Add habits here to take on later.
        </p>
        <ul class="habits__list">
          <li v-for="habit in upcoming" :key="habit.id" class="habits__row">
            <span class="habits__name">{{ habit.name }}</span>
            <Button variant="outline" size="sm" :disabled="busyId === habit.id" @click="requestActivation(habit)">
              Activate
            </Button>
          </li>
        </ul>
      </section>

      <section v-if="archived.length" class="habits__section">
        <h2 class="habits__title">Archived</h2>
        <ul class="habits__list">
          <li v-for="habit in archived" :key="habit.id" class="habits__row">
            <span class="habits__name habits__name--muted">{{ habit.name }}</span>
            <Button variant="ghost" size="sm" :disabled="busyId === habit.id" @click="setStatus(habit, 'upcoming')">
              Restore
            </Button>
          </li>
        </ul>
      </section>

      <section class="habits__section">
        <h2 class="habits__title">Add a habit</h2>
        <form class="habits__form" @submit.prevent="submit('active')">
          <div class="habits__field">
            <Label for="new-name">Name</Label>
            <Input id="new-name" v-model="form.name" required placeholder="Read a chapter" />
          </div>

          <label class="habits__toggle">
            <Checkbox
              :model-value="form.isQuantity"
              @update:model-value="form.isQuantity = Boolean($event)"
            />
            <span>Track an amount each day</span>
          </label>

          <div v-if="form.isQuantity" class="habits__row habits__row--compact">
            <div class="habits__field">
              <Label for="new-unit">Unit</Label>
              <Input id="new-unit" v-model="form.unit" />
            </div>
            <div class="habits__field">
              <Label for="new-target">Daily target</Label>
              <Input id="new-target" v-model.number="form.target" type="number" min="1" />
            </div>
          </div>

          <label class="habits__toggle">
            <Checkbox
              :model-value="form.notesEnabled"
              @update:model-value="form.notesEnabled = Boolean($event)"
            />
            <span>Let me add a note each day</span>
          </label>

          <div class="habits__actions">
            <Button type="submit" :disabled="!form.name.trim()">Add as active</Button>
            <Button
              type="button"
              variant="outline"
              :disabled="!form.name.trim()"
              @click="submit('upcoming')"
            >
              Add to upcoming
            </Button>
          </div>
        </form>
      </section>
    </template>

    <AlertDialog :open="pendingActivation !== null">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Take on another habit?</AlertDialogTitle>
          <AlertDialogDescription>
            {{ strugglingNames.join(' and ') }}
            {{ strugglingNames.length === 1 ? 'is' : 'are' }} slipping.
            Adding more now tends to make that worse — but it's your call.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="pendingActivation = null">Not yet</AlertDialogCancel>
          <AlertDialogAction @click="confirmActivation">Activate anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<style lang="scss" scoped src="./habits.scss"></style>
```

- [ ] **Step 2: Write the styles**

Create `src/pages/habits.scss`:

```scss
.habits {
  @apply mx-auto flex w-full max-w-xl flex-col gap-8;

  &__section {
    @apply flex flex-col gap-3;
  }

  &__section-head {
    @apply flex items-baseline justify-between gap-3;
  }

  &__title {
    @apply text-sm font-semibold uppercase tracking-wide text-muted-foreground;
  }

  &__count {
    @apply text-sm tabular-nums text-muted-foreground;
  }

  &__list {
    @apply flex flex-col gap-2;
  }

  &__row {
    @apply flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3;

    &--compact {
      @apply border-0 p-0;
    }
  }

  &__name {
    @apply flex-1 text-sm font-medium;

    &--muted {
      @apply text-muted-foreground;
    }
  }

  &__form {
    @apply flex flex-col gap-4 rounded-lg border p-4;
  }

  &__field {
    @apply flex flex-1 flex-col gap-1.5;
  }

  &__toggle {
    @apply flex cursor-pointer items-center gap-2 text-sm;
  }

  &__actions {
    @apply flex flex-wrap gap-2;
  }

  &__state {
    @apply text-sm text-muted-foreground;
  }

  &__error {
    @apply rounded-md border p-3 text-sm text-destructive;
    border-color: hsl(var(--destructive) / 0.4);
  }
}
```

- [ ] **Step 3: Verify in the browser**

Open `http://localhost:5173/habits`. Expected: four active habits listed with pills, empty
upcoming, and the add form. Add "Journal" to upcoming, then activate it — since nothing is
struggling yet, it activates without a prompt. Park it again and confirm it returns to upcoming.

- [ ] **Step 4: Commit**

```bash
pnpm typecheck
git add src/pages/habits.vue src/pages/habits.scss
git commit -m "feat(web): manage active habits and the upcoming backlog"
```

---

### Task 13: Navigation, docs, and full verification

**Files:**
- Modify: `src/App.vue`, `src/App.scss`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing new

- [ ] **Step 1: Add navigation**

In `src/App.vue`, replace the `<header>` block:

```vue
    <header class="app__header">
      <nav class="app__nav">
        <RouterLink to="/" class="app__brand">Habit Tracker</RouterLink>
        <RouterLink to="/log" class="app__link">Log</RouterLink>
        <RouterLink to="/habits" class="app__link">Habits</RouterLink>
      </nav>
    </header>
```

In `src/App.scss`, replace the `&__brand` block and add the nav rules:

```scss
  &__nav {
    @apply container flex h-14 items-center gap-6;
  }

  &__brand {
    @apply font-semibold tracking-tight;
  }

  &__link {
    @apply text-sm text-muted-foreground transition-colors;

    &:hover {
      @apply text-foreground;
    }

    &.router-link-active {
      @apply text-foreground;
    }
  }
```

Note: `/` carries `router-link-active` on every route, so the brand link deliberately does not
use the `&__link` styles.

- [ ] **Step 2: Update the README**

In `README.md`, replace the **Routing** section's example list and add a Screens section after
it:

```markdown
## Screens

| Route | What it does |
|---|---|
| `/` | Dashboard — an activity grid per active habit, with slipping habits called out |
| `/log` | Record a day. `?date=YYYY-MM-DD` backfills; tapping any square lands here |
| `/habits` | Manage the active list, the upcoming backlog, and the archive |
```

Add to the commands table:

```markdown
| `pnpm db:reset` | Drop the database, migrate, and reseed the four habits |
```

- [ ] **Step 3: Full verification**

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: no type errors, all tests pass, build succeeds.

- [ ] **Step 4: End-to-end check in the browser**

With `pnpm dev` running, walk the whole loop:

1. `/habits` — add "Journal" to upcoming.
2. `/log` — tick Exercise with a note, set Meditation to 5, Code reading to 20. Save.
3. `/` — Exercise's square for today is filled; Meditation's is mid-shade (5 against a target
   of 5 is level 3); Code reading's is the darkest (20 against 15 is over 1.5×… check: 20/15 is
   1.33, so level 3). Confirm no console errors.
4. Back on `/log`, change the date to yesterday, log Meditation as 10, save.
5. `/` — yesterday's Meditation square is darker than today's, which is the D-2 behaviour
   working: 10 against a target of 5 is 2×, level 4.

- [ ] **Step 5: Commit and push**

```bash
git add src/App.vue src/App.scss README.md
git commit -m "feat(web): navigation across dashboard, log and habits

Documents the three screens and db:reset in the README."
git push
```

---

## Done when

- `pnpm typecheck`, `pnpm test` and `pnpm build` all pass.
- The four habits exist, all active, seeded with today's `activatedAt`.
- Logging a day from `/log` persists and shades the right square on `/`.
- Tapping a square on `/` opens that day on `/log`.
- A habit can move active → upcoming → active, and the second activation resets its grace period.
- A struggling habit appears in the dashboard warning band with a working *Move to upcoming*.
