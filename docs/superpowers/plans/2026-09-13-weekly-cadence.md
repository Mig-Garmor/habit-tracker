# Weekly Cadence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a habit declare how many times a week it is meant to happen, and judge it against that instead of against every day.

**Architecture:** A new `times_per_week` column (default 7, so a daily habit needs no special case) flows into a rewritten consistency engine that scores whole weeks rather than days. `completionRate` and `currentStreak` move from day arithmetic to week arithmetic; the dashboard gains a per-week summary alongside the existing per-day squares; the UI gains a cadence control and a week marker.

**Tech Stack:** Drizzle ORM + Postgres (Neon in production, pglite in tests), Hono, Zod, Vue 3, Vitest, @vue/test-utils + happy-dom.

**Spec:** `docs/superpowers/specs/2026-09-13-weekly-cadence-design.md` — read it alongside this plan. **D-20 through D-26** govern this work. D-1 (performed means showed up), D-2 (shading by amount) and D-8 (days are `text`, never Postgres `date`) describe behaviour it must not disturb.

## Global Constraints

- **Weeks start on Monday.** Use the existing `startOfWeek(dateKey)` from `server/lib/date.ts`, which returns the Monday on or before a date. Never define a second notion of "week" (D-23).
- **Days are `text`, `YYYY-MM-DD`, local calendar days.** Never a Postgres `date`, never a JS `Date` crossing a boundary (D-8).
- **`timesPerWeek` is an integer 1–7, default 7.** Validated in Zod at the edge, never as a Postgres enum or check constraint (D-7, D-26).
- **A week counts only if complete and fully elapsed since activation — unless it already met cadence, in which case it counts anyway** (D-21). This single rule covers both the current week and the activation week.
- **Each week caps at 100%** (D-22). Extra sessions never carry into another week.
- **Window is 4 complete weeks; grace is 2 complete weeks** (D-24).
- **Thresholds are unchanged:** `struggling` below 0.5, `consistent` at or above 0.8.
- **Every relative import ends in `.js`** (D-17). `moduleResolution` is `nodenext`; an extensionless import passes bundlers and fails on Vercel at runtime.
- **Never read configuration at module scope** (D-18).
- Run `npx vitest run`, `pnpm typecheck` and `pnpm build`. The suite must stay network-free.

---

### Task 1: Week arithmetic

Pure date helpers the scoring engine needs. No database, no habits — just weeks.

**Files:**
- Modify: `server/lib/date.ts`
- Test: `server/lib/date.spec.ts`

**Interfaces:**
- Consumes: `startOfWeek(dateKey: string): string`, `previousDay`, `nextDay`, `dateRange` — all already in `server/lib/date.ts`.
- Produces:
  - `lastNWeekStarts(n: number, upTo: string): string[]` — the Mondays of the `n` weeks ending with the week containing `upTo`, ascending. The last element is always `startOfWeek(upTo)`.
  - `weekDays(weekStart: string): string[]` — the seven `YYYY-MM-DD` days of that week, Monday first.
  - `isWeekComplete(weekStart: string, today: string): boolean` — true when the whole week is in the past relative to `today`.
  - `nextWeek(weekStart: string): string` — the Monday seven days later.
  - `previousWeek(weekStart: string): string` — the Monday seven days earlier.

- [ ] **Step 1: Write the failing tests**

Append to `server/lib/date.spec.ts`:

```ts
describe('lastNWeekStarts', () => {
  it('ends with the week containing the given day', () => {
    // 2026-09-13 is a Sunday; its week starts Monday 2026-09-07.
    expect(lastNWeekStarts(1, '2026-09-13')).toEqual(['2026-09-07'])
  })

  it('walks back whole weeks, ascending', () => {
    expect(lastNWeekStarts(3, '2026-09-13')).toEqual(['2026-08-24', '2026-08-31', '2026-09-07'])
  })

  it('works when the day is itself a Monday', () => {
    expect(lastNWeekStarts(2, '2026-09-07')).toEqual(['2026-08-31', '2026-09-07'])
  })

  it('returns nothing for a non-positive count', () => {
    expect(lastNWeekStarts(0, '2026-09-13')).toEqual([])
  })
})

describe('weekDays', () => {
  it('returns seven days, Monday first', () => {
    expect(weekDays('2026-09-07')).toEqual([
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
      '2026-09-11', '2026-09-12', '2026-09-13',
    ])
  })

  it('crosses a month boundary', () => {
    expect(weekDays('2026-08-31')[6]).toBe('2026-09-06')
  })
})

describe('nextWeek and previousWeek', () => {
  it('advance and retreat exactly seven days', () => {
    expect(nextWeek('2026-08-31')).toBe('2026-09-07')
    expect(previousWeek('2026-09-07')).toBe('2026-08-31')
  })

  it('cross a month boundary', () => {
    expect(nextWeek('2026-08-24')).toBe('2026-08-31')
    expect(previousWeek('2026-09-07')).toBe('2026-08-31')
  })

  it('round-trip', () => {
    expect(previousWeek(nextWeek('2026-09-07'))).toBe('2026-09-07')
  })
})

describe('isWeekComplete', () => {
  it('is false for the week containing today', () => {
    expect(isWeekComplete('2026-09-07', '2026-09-13')).toBe(false)
  })

  it('is false on the last day of the week, which has not finished', () => {
    expect(isWeekComplete('2026-09-07', '2026-09-13')).toBe(false)
  })

  it('is true once the week is entirely past', () => {
    expect(isWeekComplete('2026-08-31', '2026-09-07')).toBe(true)
  })
})
```

Add `lastNWeekStarts, weekDays, isWeekComplete, nextWeek, previousWeek` to the existing import from `./date.js` at the top of the spec.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run server/lib/date.spec.ts`
Expected: FAIL — `lastNWeekStarts is not a function`.

- [ ] **Step 3: Implement**

Append to `server/lib/date.ts`:

```ts
/** The seven days of the week beginning `weekStart`, Monday first. */
export function weekDays(weekStart: string): string[] {
  const days = [weekStart]
  for (let i = 1; i < 7; i++) days.push(nextDay(days[i - 1]!))
  return days
}

/** The Monday seven days after `weekStart`. */
export function nextWeek(weekStart: string): string {
  let cursor = weekStart
  for (let i = 0; i < 7; i++) cursor = nextDay(cursor)
  return cursor
}

/** The Monday seven days before `weekStart`. */
export function previousWeek(weekStart: string): string {
  let cursor = weekStart
  for (let i = 0; i < 7; i++) cursor = previousDay(cursor)
  return cursor
}

/**
 * The Mondays of the `n` weeks ending with the week that contains `upTo`,
 * ascending. The last element is always `startOfWeek(upTo)`.
 */
export function lastNWeekStarts(n: number, upTo: string): string[] {
  if (n <= 0) return []
  const starts = [startOfWeek(upTo)]
  for (let i = 1; i < n; i++) starts.unshift(previousWeek(starts[0]!))
  return starts
}

/**
 * Whether the whole week beginning `weekStart` is in the past. The week
 * containing `today` is never complete — not even on its last day, which is
 * still being lived (D-21).
 */
export function isWeekComplete(weekStart: string, today: string): boolean {
  return weekStart < startOfWeek(today)
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run server/lib/date.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/date.ts server/lib/date.spec.ts
git commit -m "feat(date): week arithmetic for cadence scoring"
```

---

### Task 2: Cadence-aware scoring

Rewrites the consistency engine to score whole weeks. This is where D-21, D-22, D-24 and D-25 live.

**Files:**
- Modify: `server/lib/consistency.ts`
- Modify: `server/lib/consistency.spec.ts`
- Test: `server/lib/consistency.spec.ts`

**Interfaces:**
- Consumes: `lastNWeekStarts`, `weekDays`, `isWeekComplete`, `startOfWeek` from `server/lib/date.js` (Task 1).
- Produces:
  - `WINDOW_WEEKS = 4`, `GRACE_WEEKS = 2` (replacing `WINDOW_DAYS` and `GRACE_DAYS`, which are deleted).
  - `weekSummaries(completedDates: Iterable<string>, today: string, activatedAt: string | null, timesPerWeek: number): WeekSummary[]`
  - `interface WeekSummary { start: string, completed: number, expected: number, met: boolean }`
  - `completionRate(completedDates, today, activatedAt, timesPerWeek): number`
  - `currentStreak(completedDates, today, activatedAt, timesPerWeek): number` — **moves here from `date.ts`**, because it now needs cadence. Delete the old day-based one from `date.ts` and its tests.
  - `classifyHealth(completedDates, today, activatedAt, timesPerWeek): Health`

- [ ] **Step 1: Write the failing tests**

Replace the body of `server/lib/consistency.spec.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import {
  classifyHealth, completionRate, currentStreak, weekSummaries,
} from './consistency.js'
import { weekDays } from './date.js'

// Monday 2026-08-17, 2026-08-24, 2026-08-31, 2026-09-07. "Today" is Wed 2026-09-09.
const TODAY = '2026-09-09'
const ACTIVATED = '2026-06-01'

/** The first `n` days of the week starting `weekStart`, Monday onward. */
function daysIn(weekStart: string, n: number): string[] {
  return weekDays(weekStart).slice(0, n)
}

const W1 = '2026-08-17'
const W2 = '2026-08-24'
const W3 = '2026-08-31'
const W4 = '2026-09-07' // the week containing TODAY — incomplete

describe('completionRate with cadence', () => {
  it('scores a 4x/week habit kept exactly as 1.0', () => {
    const done = [...daysIn(W1, 4), ...daysIn(W2, 4), ...daysIn(W3, 4)]
    expect(completionRate(done, TODAY, ACTIVATED, 4)).toBe(1)
  })

  it('scores a 1x/week habit kept exactly as 1.0', () => {
    const done = [...daysIn(W1, 1), ...daysIn(W2, 1), ...daysIn(W3, 1)]
    expect(completionRate(done, TODAY, ACTIVATED, 1)).toBe(1)
  })

  it('caps a week at 100% and does not carry the surplus (D-22)', () => {
    // 6 then 2 against a cadence of 4 is 75%, not 100%.
    const done = [...daysIn(W2, 6), ...daysIn(W3, 2)]
    expect(completionRate(done, TODAY, ACTIVATED, 4)).toBeCloseTo(0.75, 5)
  })

  it('ignores an unmet week in progress (D-21)', () => {
    const done = [...daysIn(W1, 4), ...daysIn(W2, 4), ...daysIn(W3, 4), ...daysIn(W4, 1)]
    // The single day of the current week must not drag 1.0 down.
    expect(completionRate(done, TODAY, ACTIVATED, 4)).toBe(1)
  })

  it('counts a week in progress once it has met cadence (D-21)', () => {
    const done = [...daysIn(W3, 0), ...daysIn(W4, 2)]
    // W4 met a cadence of 2, so it counts; W1-W3 are complete and empty.
    expect(completionRate(done, TODAY, ACTIVATED, 2)).toBeCloseTo(0.25, 5)
  })

  it('ignores the activation week unless it met cadence (D-21)', () => {
    // Activated mid-W3, did 1 of 4 that week. W3 must not count.
    const done = daysIn(W3, 1)
    expect(completionRate(done, TODAY, '2026-09-03', 4)).toBe(0)
  })

  it('returns 0 when the habit was never activated', () => {
    expect(completionRate([], TODAY, null, 4)).toBe(0)
  })
})

describe('currentStreak in weeks (D-25)', () => {
  it('counts consecutive complete weeks that met cadence', () => {
    const done = [...daysIn(W1, 4), ...daysIn(W2, 4), ...daysIn(W3, 4)]
    expect(currentStreak(done, TODAY, ACTIVATED, 4)).toBe(3)
  })

  it('is not broken by a week in progress that has not met cadence yet', () => {
    const done = [...daysIn(W2, 4), ...daysIn(W3, 4), ...daysIn(W4, 1)]
    expect(currentStreak(done, TODAY, ACTIVATED, 4)).toBe(2)
  })

  it('includes the week in progress once it has met cadence', () => {
    const done = [...daysIn(W2, 4), ...daysIn(W3, 4), ...daysIn(W4, 4)]
    expect(currentStreak(done, TODAY, ACTIVATED, 4)).toBe(3)
  })

  it('breaks on a complete week that missed cadence', () => {
    const done = [...daysIn(W1, 4), ...daysIn(W2, 1), ...daysIn(W3, 4)]
    expect(currentStreak(done, TODAY, ACTIVATED, 4)).toBe(1)
  })

  it('is 0 with nothing logged', () => {
    expect(currentStreak([], TODAY, ACTIVATED, 4)).toBe(0)
  })
})

describe('classifyHealth with cadence', () => {
  it('is new inside the grace period', () => {
    expect(classifyHealth([], TODAY, '2026-09-07', 4)).toBe('new')
  })

  it('rates a perfectly kept 4x/week habit consistent, which it never could before', () => {
    const done = [...daysIn(W1, 4), ...daysIn(W2, 4), ...daysIn(W3, 4)]
    expect(classifyHealth(done, TODAY, ACTIVATED, 4)).toBe('consistent')
  })

  it('rates a perfectly kept weekly habit consistent, not struggling', () => {
    const done = [...daysIn(W1, 1), ...daysIn(W2, 1), ...daysIn(W3, 1)]
    expect(classifyHealth(done, TODAY, ACTIVATED, 1)).toBe('consistent')
  })

  it('still calls a genuinely neglected habit struggling', () => {
    expect(classifyHealth(daysIn(W1, 1), TODAY, ACTIVATED, 4)).toBe('struggling')
  })
})

describe('weekSummaries', () => {
  it('reports every window week plus the current one, ascending', () => {
    const summaries = weekSummaries(daysIn(W3, 2), TODAY, ACTIVATED, 4)
    expect(summaries.map(s => s.start)).toEqual([W1, W2, W3, W4])
  })

  it('reports completed, expected and met per week', () => {
    const summaries = weekSummaries(daysIn(W3, 4), TODAY, ACTIVATED, 4)
    const third = summaries.find(s => s.start === W3)!
    expect(third).toEqual({ start: W3, completed: 4, expected: 4, met: true })
  })

  it('counts days beyond cadence without marking more than met', () => {
    const summaries = weekSummaries(daysIn(W3, 6), TODAY, ACTIVATED, 4)
    const third = summaries.find(s => s.start === W3)!
    expect(third.completed).toBe(6)
    expect(third.met).toBe(true)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run server/lib/consistency.spec.ts`
Expected: FAIL — `weekSummaries is not a function`, and `completionRate` called with four arguments.

- [ ] **Step 3: Implement**

Replace `server/lib/consistency.ts` with:

```ts
import {
  isWeekComplete, lastNWeekStarts, nextWeek, previousWeek, startOfWeek, weekDays,
} from './date.js'

/**
 * How consistent a habit is, and whether to suggest parking it. Change these
 * four numbers and the whole warning system moves with them.
 */
export const WINDOW_WEEKS = 4
export const GRACE_WEEKS = 2
export const STRUGGLING_BELOW = 0.5
export const CONSISTENT_AT_OR_ABOVE = 0.8

export type Health = 'new' | 'struggling' | 'steady' | 'consistent'

export interface WeekSummary {
  start: string
  completed: number
  expected: number
  met: boolean
}

/**
 * One entry per week in the window, oldest first, always including the week
 * that contains `today`. `completed` is the real count, uncapped, so the UI can
 * show a genuinely heavy week; `met` is what scoring uses (D-22).
 */
export function weekSummaries(
  completedDates: Iterable<string>,
  today: string,
  activatedAt: string | null,
  timesPerWeek: number,
): WeekSummary[] {
  if (!activatedAt) return []
  const completed = new Set(completedDates)
  const expected = Math.max(1, timesPerWeek)

  return lastNWeekStarts(WINDOW_WEEKS, today).map(start => {
    const done = weekDays(start).filter(day => completed.has(day)).length
    return { start, completed: done, expected, met: done >= expected }
  })
}

/**
 * Whether a week may be scored (D-21). A week counts when it is complete and
 * began on or after activation. A week that fails either test counts anyway if
 * it already met cadence — so the week in progress and the week a habit was
 * created can lift the score but never lower it.
 */
function weekCounts(summary: WeekSummary, today: string, activatedAt: string): boolean {
  const settled = isWeekComplete(summary.start, today) && summary.start >= startOfWeek(activatedAt)
  return settled || summary.met
}

/** Mean of capped week scores over the countable weeks (D-22, D-24). */
export function completionRate(
  completedDates: Iterable<string>,
  today: string,
  activatedAt: string | null,
  timesPerWeek: number,
): number {
  if (!activatedAt) return 0

  const counted = weekSummaries(completedDates, today, activatedAt, timesPerWeek)
    .filter(summary => weekCounts(summary, today, activatedAt))
  if (counted.length === 0) return 0

  const total = counted.reduce(
    (sum, summary) => sum + Math.min(1, summary.completed / summary.expected),
    0,
  )
  return total / counted.length
}

/**
 * Consecutive weeks that met cadence, most recent first (D-25). The week in
 * progress does not break a streak merely by being unfinished — the same
 * tolerance D-4 gives an unlogged today.
 */
export function currentStreak(
  completedDates: Iterable<string>,
  today: string,
  activatedAt: string | null,
  timesPerWeek: number,
): number {
  if (!activatedAt) return 0

  // Enough history that a long streak is not truncated by the scoring window.
  const completed = new Set(completedDates)
  const expected = Math.max(1, timesPerWeek)
  let cursor = startOfWeek(today)
  let streak = 0

  // An unmet current week is skipped rather than counted as a break.
  const thisWeekDone = weekDays(cursor).filter(day => completed.has(day)).length
  if (thisWeekDone < expected) {
    cursor = previousWeek(cursor)
  }

  while (true) {
    const done = weekDays(cursor).filter(day => completed.has(day)).length
    if (done < expected) break
    streak += 1
    cursor = previousWeek(cursor)
  }

  return streak
}

/** Whole weeks between the activation week and the current one — 0 during it. */
function weeksSinceActivation(activatedAt: string, today: string): number {
  let cursor = startOfWeek(activatedAt)
  const target = startOfWeek(today)
  let weeks = 0
  while (cursor < target) {
    cursor = nextWeek(cursor)
    weeks += 1
  }
  return weeks
}

export function classifyHealth(
  completedDates: Iterable<string>,
  today: string,
  activatedAt: string | null,
  timesPerWeek: number,
): Health {
  if (!activatedAt) return 'new'
  if (weeksSinceActivation(activatedAt, today) < GRACE_WEEKS) return 'new'

  const rate = completionRate(completedDates, today, activatedAt, timesPerWeek)
  if (rate < STRUGGLING_BELOW) return 'struggling'
  if (rate >= CONSISTENT_AT_OR_ABOVE) return 'consistent'
  return 'steady'
}
```

- [ ] **Step 4: Delete the old day-based streak**

Remove `currentStreak` from `server/lib/date.ts` and its tests from `server/lib/date.spec.ts`. `noUnusedLocals` will surface any leftover import.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run server/lib/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/lib/consistency.ts server/lib/consistency.spec.ts server/lib/date.ts server/lib/date.spec.ts
git commit -m "feat(consistency): score whole weeks against a cadence"
```

---

### Task 3: The column, the API, and the dashboard

Adds `times_per_week` and threads it through every route that reads or writes a habit.

**Files:**
- Modify: `server/db/schema.ts`
- Create: `drizzle/0002_*.sql` (generated)
- Modify: `server/validation.ts`
- Modify: `server/routes/habits.ts`
- Modify: `server/lib/dashboard.ts`
- Modify: `server/routes/dashboard.ts`
- Test: `server/routes/habits.spec.ts`

**Interfaces:**
- Consumes: `completionRate`, `currentStreak`, `classifyHealth`, `weekSummaries`, `WeekSummary` from `server/lib/consistency.js` (Task 2), all taking `timesPerWeek` as their final argument.
- Produces:
  - `habits.timesPerWeek` on every habit payload.
  - `DashboardHabit.weeks: WeekSummary[]`.
  - `createHabitSchema` / `updateHabitSchema` accepting `timesPerWeek`.

- [ ] **Step 1: Add the column**

In `server/db/schema.ts`, inside `habits`, after `position`:

```ts
  /**
   * How many times a week the habit is meant to happen (D-20). 7 means daily,
   * so every existing habit is already correct and no calculation needs a
   * "daily" special case (D-26).
   */
  timesPerWeek: integer('times_per_week').notNull().default(7),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/0002_*.sql` containing `ALTER TABLE "habits" ADD COLUMN "times_per_week" integer DEFAULT 7 NOT NULL;`

No backfill statement is needed — the default is already correct for every existing row (D-26).

- [ ] **Step 3: Write the failing route tests**

Append to `server/routes/habits.spec.ts`:

```ts
describe('cadence', () => {
  it('defaults a new habit to seven times a week', async () => {
    const { habit } = await readJson<{ habit: Habit }>(post('/api/habits', { name: 'Daily thing' }))
    expect(habit.timesPerWeek).toBe(7)
  })

  it('accepts a cadence on create', async () => {
    const { habit } = await readJson<{ habit: Habit }>(
      post('/api/habits', { name: 'Gym', timesPerWeek: 4 }),
    )
    expect(habit.timesPerWeek).toBe(4)
  })

  it('accepts a cadence change', async () => {
    const { habit } = await readJson<{ habit: Habit }>(post('/api/habits', { name: 'Video' }))
    const { habit: updated } = await readJson<{ habit: Habit }>(
      patch(`/api/habits/${habit.id}`, { timesPerWeek: 1 }),
    )
    expect(updated.timesPerWeek).toBe(1)
  })

  it('rejects a cadence below one', async () => {
    expect((await post('/api/habits', { name: 'Never', timesPerWeek: 0 })).status).toBe(400)
  })

  it('rejects a cadence above seven', async () => {
    expect((await post('/api/habits', { name: 'Twice daily', timesPerWeek: 8 })).status).toBe(400)
  })

  it('rejects a fractional cadence', async () => {
    expect((await post('/api/habits', { name: 'Half', timesPerWeek: 2.5 })).status).toBe(400)
  })

  it('reports weeks on the dashboard, agreeing with the habit cadence', async () => {
    const { habit } = await readJson<{ habit: Habit }>(
      post('/api/habits', { name: 'Cadenced', timesPerWeek: 3 }),
    )
    const body = await readJson<{ habits: { id: number, weeks: { expected: number }[] }[] }>(
      app.request('/api/dashboard', { headers: { cookie } }),
    )
    const row = body.habits.find(h => h.id === habit.id)!
    expect(row.weeks).toHaveLength(4)
    expect(row.weeks.every(week => week.expected === 3)).toBe(true)
  })
})
```

- [ ] **Step 4: Run them and watch them fail**

Run: `npx vitest run server/routes/habits.spec.ts`
Expected: FAIL — `timesPerWeek` is `undefined`, and `weeks` does not exist.

- [ ] **Step 5: Validate the cadence**

In `server/validation.ts`, beside the existing `name`/`unit`/`target` field helpers:

```ts
const timesPerWeek = z
  .number()
  .int('Cadence must be a whole number of days')
  .min(1, 'A habit must happen at least once a week')
  .max(7, 'A habit cannot happen more than once a day')
```

Add `timesPerWeek: timesPerWeek.default(7)` to `createHabitSchema`'s object, and `timesPerWeek: timesPerWeek.optional()` to `updateHabitSchema`'s object.

- [ ] **Step 6: Thread it through the dashboard**

In `server/lib/dashboard.ts`:

- Add `timesPerWeek: number` to `DashboardHabitInput`.
- Add `weeks: WeekSummary[]` to `DashboardHabit`.
- Import `weekSummaries` and `WeekSummary` from `./consistency.js`.
- In the `habits.map(...)` body, pass `habit.timesPerWeek` as the fourth argument to `currentStreak`, `completionRate` and `classifyHealth`, and add:

```ts
      weeks: weekSummaries(completedDates, today, habit.activatedAt, habit.timesPerWeek),
```

`currentStreak` now comes from `./consistency.js`, not `./date.js` — update the import.

- [ ] **Step 7: Run the tests and watch them pass**

Run: `npx vitest run`
Expected: PASS. If a pre-existing dashboard or consistency test asserts an exact `rate`, adjust the expectation — D-24 deliberately changes the window from a rolling 14 days to 4 complete weeks. Do not weaken an assertion to make it pass; recompute what it should now be and say so in the commit.

- [ ] **Step 8: Typecheck, build, commit**

```bash
pnpm typecheck && pnpm build
git add server/ drizzle/
git commit -m "feat(habits): store and serve a weekly cadence"
```

---

### Task 4: Cadence in the UI

Lets a cadence be set and seen, and marks the weeks that met it.

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/pages/habits.vue`
- Modify: `src/pages/habits.scss`
- Modify: `src/components/ActivityGrid.vue`
- Modify: `src/components/ActivityGrid.scss`
- Test: `src/pages/habits.cadence.spec.ts` (create)

**Interfaces:**
- Consumes: `Habit.timesPerWeek`, `DashboardHabit.weeks: { start, completed, expected, met }[]` from Task 3.
- Produces: nothing later tasks depend on — this is the last task.

- [ ] **Step 1: Extend the client types**

In `src/lib/api.ts`, add `timesPerWeek: number` to `interface Habit`, add the same to `CreateHabitInput` and `UpdateHabitInput` as optional, and add to `DashboardHabit`:

```ts
  weeks: { start: string, completed: number, expected: number, met: boolean }[]
```

- [ ] **Step 2: Write the failing component test**

Create `src/pages/habits.cadence.spec.ts`, modelled on the existing `src/pages/habits.reorder.spec.ts` — copy its `vi.mock('@/lib/api', ...)` block and `mountPage` helper, adding `timesPerWeek` to the fake habits and `updateHabit` to the mock:

```ts
// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateHabit = vi.fn().mockImplementation((id: number, patch: Record<string, unknown>) =>
  Promise.resolve({ id, name: 'Gym', kind: 'binary', unit: null, target: null,
    notesEnabled: false, status: 'active', activatedAt: '2026-09-01',
    createdAt: '2026-09-01T00:00:00.000Z', timesPerWeek: patch.timesPerWeek ?? 4 }))

vi.mock('@/lib/api', () => ({
  fetchHabits: () => Promise.resolve([{
    id: 1, name: 'Gym', kind: 'binary', unit: null, target: null, notesEnabled: false,
    status: 'active', activatedAt: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z',
    timesPerWeek: 4,
  }]),
  fetchDashboard: () => Promise.resolve({ habits: [] }),
  createHabit: vi.fn(),
  reorderHabits: vi.fn(),
  updateHabit: (id: number, patch: Record<string, unknown>) => updateHabit(id, patch),
}))

describe('editing a cadence', () => {
  beforeEach(() => {
    updateHabit.mockClear()
    document.body.innerHTML = ''
  })

  it('shows the habit’s current cadence', async () => {
    const HabitsPage = (await import('./habits.vue')).default
    const wrapper = mount(HabitsPage, { attachTo: document.body })
    await flushPromises()
    const field = wrapper.find<HTMLInputElement>('[data-cadence="1"]')
    expect(field.element.value).toBe('4')
  })

  it('saves a changed cadence', async () => {
    const HabitsPage = (await import('./habits.vue')).default
    const wrapper = mount(HabitsPage, { attachTo: document.body })
    await flushPromises()
    const field = wrapper.find('[data-cadence="1"]')
    await field.setValue('2')
    await field.trigger('blur')
    await flushPromises()
    expect(updateHabit).toHaveBeenCalledWith(1, { timesPerWeek: 2 })
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/pages/habits.cadence.spec.ts`
Expected: FAIL — no element matches `[data-cadence="1"]`.

- [ ] **Step 4: Add the cadence control**

In `src/pages/habits.vue`, mirror the existing `targetDrafts` pattern exactly — a `cadenceDrafts` ref keyed by habit id, filled in `load()`, committed on blur through `updateHabit(habit.id, { timesPerWeek })`. In the active-habit row, after the target block:

```html
            <div class="habits__cadence">
              <Input
                type="number"
                min="1"
                max="7"
                step="1"
                inputmode="numeric"
                :model-value="cadenceDrafts[habit.id] ?? 7"
                :disabled="busyId === habit.id"
                class="habits__cadence-input"
                :data-cadence="habit.id"
                :aria-label="`Times a week for ${habit.name}`"
                @update:model-value="cadenceDrafts[habit.id] = Number($event)"
                @blur="updateCadence(habit)"
                @keydown.enter.prevent="($event.target as HTMLElement).blur()"
              />
              <span class="habits__cadence-unit">× / week</span>
            </div>
```

Add to `src/pages/habits.scss`, beside `&__target`:

```scss
  &__cadence {
    @apply flex items-center gap-2;
  }

  &__cadence-input {
    @apply w-16 tabular-nums;
  }

  &__cadence-unit {
    @apply text-sm text-muted-foreground;
  }
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/pages/habits.cadence.spec.ts`
Expected: PASS.

- [ ] **Step 6: Add cadence to the add-habit form**

The form currently creates every habit as daily, so a 4×/week habit would have
to be created and then immediately edited. In `src/pages/habits.vue`, add
`timesPerWeek: 7` to the `form` ref, and a field inside `.habits__form`, after
the "Track an amount each day" toggle:

```html
          <div class="habits__field">
            <Label for="new-cadence">Times a week</Label>
            <Input
              id="new-cadence"
              v-model.number="form.timesPerWeek"
              type="number"
              min="1"
              max="7"
              step="1"
              inputmode="numeric"
            />
          </div>
```

Pass it through in `submit()`, alongside the existing fields:

```ts
    timesPerWeek: form.value.timesPerWeek,
```

Extend the component spec to cover it, in `src/pages/habits.cadence.spec.ts`:

```ts
  it('creates a habit with the chosen cadence', async () => {
    const HabitsPage = (await import('./habits.vue')).default
    const wrapper = mount(HabitsPage, { attachTo: document.body })
    await flushPromises()

    await wrapper.find('#new-name').setValue('Gym')
    await wrapper.find('#new-cadence').setValue('4')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createHabit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Gym', timesPerWeek: 4 }),
    )
  })
```

Promote `createHabit` in that spec's mock from `vi.fn()` to a module-scope
`const createHabit = vi.fn().mockResolvedValue({ id: 2, name: 'Gym', timesPerWeek: 4 })`
so it can be asserted on, exactly as `updateHabit` already is.

- [ ] **Step 7: Mark the weeks that met cadence**

In `src/components/ActivityGrid.vue`, accept a `weeks` prop of the shape in Step 1 and add a modifier class to each week column whose `met` is true. In `src/components/ActivityGrid.scss`:

```scss
  &__week {
    &--met {
      /* A 2px rule under the column: legible at a glance, and it reads as a
         property of the week rather than of any single day (D-23). */
      @apply border-b-2 border-primary/50;
    }
  }
```

Pass `:weeks="habit.weeks"` where the dashboard renders each grid.

- [ ] **Step 8: State the cadence beside the rate**

Where the dashboard shows a habit's name and health, add the cadence so the percentage is interpretable — a habit reading 100% should say what it is 100% *of*:

```html
<span class="dashboard__cadence">{{ habit.timesPerWeek === 7 ? 'daily' : `${habit.timesPerWeek}× a week` }}</span>
```

- [ ] **Step 9: Verify in the browser**

Start the dev server via the preview tool, sign in, and check:
- a habit's cadence can be changed and survives a reload
- the dashboard marks weeks that met cadence
- a 4×/week habit kept to 4 reads `consistent` rather than `steady`

- [ ] **Step 10: Full verification and commit**

```bash
npx vitest run && pnpm typecheck && pnpm build
git add src/
git commit -m "feat(web): set a habit's cadence and mark the weeks that met it"
```

---

## Done when

- `npx vitest run`, `pnpm typecheck` and `pnpm build` all pass, suite still network-free.
- A 4×/week habit kept exactly reads `consistent`; a 1×/week habit kept exactly reads `consistent`.
- An unmet week in progress never lowers a rate or breaks a streak.
- A week done six times against a cadence of four scores 1.0 for that week and does not lift the next.
- The dashboard returns four weeks per habit, and marks the ones that met cadence.
- Existing daily habits behave as before apart from the window change D-24 describes.
