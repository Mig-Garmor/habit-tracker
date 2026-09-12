# Habit tracking core — dashboard, daily logging, and habit lifecycle

> Status: approved, not yet implemented
> Date: 2026-09-12

Turns the scaffold's single tick-box screen into the actual tracker: contribution-style
activity grids, a screen for recording a day, and an active/upcoming lifecycle that pushes
back when a habit isn't sticking.

## Why this shape

One requirement drives the whole design. Meditation is logged as *minutes*, the target may
rise from 5 to 10, and the old 5-minute days must stay visibly distinct from the new
10-minute ones. That means **an entry records what you actually did, not merely that you did
it** — and once entries carry a value, quantity habits, notes, and amount-shaded squares all
fall out of the same model.

## Data model

### `habits`

| Column | Type | Notes |
|---|---|---|
| `id` | integer pk | |
| `name` | text | |
| `kind` | text | `binary` \| `quantity` |
| `unit` | text nullable | `minutes`; null for binary |
| `target` | real nullable | daily goal for quantity habits; null for binary |
| `notesEnabled` | boolean | shows the note field on the log screen |
| `status` | text | `active` \| `upcoming` \| `archived` |
| `activatedAt` | text nullable | date the habit last entered `active` |
| `createdAt` | text | |

`archivedAt` is removed; `status` replaces it, because a habit now has three states rather
than two.

### `habit_entries`

| Column | Type | Notes |
|---|---|---|
| `id` | integer pk | |
| `habitId` | integer fk | cascade delete |
| `date` | text | local day, `YYYY-MM-DD` |
| `completed` | boolean | did it at all |
| `value` | real nullable | minutes, reps, …; null for binary habits |
| `note` | text nullable | |

Unique on `(habitId, date)` — one row per habit per day.

## Semantics

These are the decisions a future change could silently get wrong.

**D-1 — "Performed" means showed up, not hit the target.** For a quantity habit, `completed`
is true when `value > 0`. Logging 5 minutes against a 10-minute target *is* a completed day.
Hitting the target is tracked separately and drives square colour only. The consistency
warning is about showing up.

**D-2 — Square colour is relative to the habit's current target.** Levels recompute when the
target changes; entries never change. Raising Meditation 5 → 10 re-shades history so former
full-marks days become mid-tone. The record of what was done (`value = 5`) is untouched.

**D-3 — Reactivating a habit resets its grace period.** Moving `upcoming → active` sets
`activatedAt` to today, so a returning habit gets a fresh 14 days before it can be warned
about.

**D-4 — Streaks tolerate an unlogged today.** The streak counts consecutive completed days
ending at today; if today has no completed entry, it counts to yesterday instead. If neither today nor yesterday is completed the streak is 0. Without
this the streak reads 0 every morning until you log. **This changes existing behaviour** —
`currentStreak` in `server/lib/date.ts` currently returns 0 when today is incomplete, and its
test asserts that. Both change.

**D-5 — Entries survive every lifecycle move.** Moving to `upcoming` or `archived` hides a
habit from the dashboard and log screen but never deletes history. Reactivating shows the old
squares again.

**D-6 — Notes are never destroyed by the flag.** `notesEnabled` controls whether the log
screen offers a note field. Turning it off keeps existing notes, and they stay visible when
viewing a past day.

## Activity levels

`activityLevel(habit, entry) → 0..4`, computed server-side so the rule stays in one tested
module rather than in a Vue component.

Binary habits: `0` when not completed, `3` when completed.

Quantity habits, against the habit's current `target`:

| Logged value `v` | Level |
|---|---|
| no entry, or `v = 0` | 0 |
| `0 < v < target × 0.5` | 1 |
| `target × 0.5 ≤ v < target` | 2 |
| `target ≤ v < target × 1.5` | 3 |
| `v ≥ target × 1.5` | 4 |

A quantity habit with a null target falls back to binary shading.

Worked example — Meditation, target 10: a 5-minute day is level 2, a 10-minute day level 3, a
20-minute day level 4. The 5-minute days stay permanently lighter, which is the requirement.

## Consistency and warnings

Thresholds live as exported constants at the top of `server/lib/consistency.ts`.

```
GRACE_DAYS = 14
WINDOW_DAYS = 14
STRUGGLING_BELOW = 0.5
CONSISTENT_AT_OR_ABOVE = 0.8
```

`completionRate(entries, upTo, activatedAt)` — completed days divided by eligible days across
the trailing `WINDOW_DAYS` ending at `upTo`. Days before `activatedAt` are excluded from the
denominator, so a habit active for 5 days is judged out of 5, not out of 14.

`classifyHealth(habit, entries, today) → 'new' | 'struggling' | 'steady' | 'consistent'`

| State | Rule |
|---|---|
| `new` | fewer than `GRACE_DAYS` since `activatedAt` — never warned |
| `struggling` | rate below `STRUGGLING_BELOW` |
| `consistent` | rate at or above `CONSISTENT_AT_OR_ABOVE` |
| `steady` | anything between |

Struggling habits surface at the top of the dashboard with a *Move to Upcoming* action.

**No hard cap on active habits.** The `/habits` screen reports how many active habits are
consistent, and activating an upcoming habit while any active one is struggling shows a
confirm — "Meditation is struggling. Add another anyway?" — that can be clicked through. The
backlog itself is the mechanism for not taking on too much; a block would be the app
overruling the user.

## API

All dates are local `YYYY-MM-DD`. Future dates are rejected with `400`.

```
GET   /api/habits[?status=...]                       list habits; omit status for all
POST  /api/habits                                    create
PATCH /api/habits/:id                                update fields or status
GET   /api/dashboard?weeks=15                        grids + health + streaks
GET   /api/log/:date                                 habits + that day's entries
PUT   /api/log/:date                                 upsert the whole day
```

`GET /api/habits/today` and the current homepage are removed.

**`GET /api/dashboard`** — `weeks` defaults to 15, clamped 1–53. `from` is the Monday on or
before `today − weeks × 7` days, so every grid starts on a week boundary and its columns are
whole weeks.

```jsonc
{
  "today": "2026-09-12",
  "from": "2026-05-25",
  "habits": [{
    "id": 3, "name": "Meditation", "kind": "quantity", "unit": "minutes",
    "target": 5, "notesEnabled": false, "status": "active",
    "activatedAt": "2026-09-12",
    "health": "new", "streak": 3, "rate": 0.71,
    "days": [{ "date": "2026-05-30", "completed": false, "value": null, "note": null, "level": 0 }]
  }],
  "warnings": [{ "habitId": 4, "name": "Record one video", "rate": 0.21 }]
}
```

`days` is dense — every date in the range, including days with no entry — so the grid renders
without client-side gap filling.

**`GET /api/log/:date`**

```jsonc
{
  "date": "2026-09-12",
  "isToday": true,
  "habits": [{
    "id": 1, "name": "Exercise", "kind": "binary", "unit": null, "target": null,
    "notesEnabled": true,
    "entry": { "completed": true, "value": null, "note": "squats, 5k" }
  }]
}
```

`entry` is `null` when the day has not been logged.

**`PUT /api/log/:date`** — body `{ "entries": [{ "habitId": 1, "completed": true, "value": null, "note": "squats" }] }`.
Upserts each entry and returns the same shape as `GET`. Habits omitted from `entries` are left
untouched, so a partial save never wipes a day. Entries for archived habits are rejected with
`400`; `upcoming` habits are accepted, which is what makes backfilling a demoted habit possible. For quantity habits the server derives
`completed` from `value > 0` rather than trusting the client.

**`POST /api/habits`** — `{ name, kind, unit, target, notesEnabled, status }`. Creating with
`status: "active"` sets `activatedAt` to today.

**`PATCH /api/habits/:id`** — partial. Setting `status` to `active` from `upcoming` sets
`activatedAt` to today (D-3).

Request validation uses **Zod** via `@hono/zod-validator` — two new dependencies. Route
handlers stay free of hand-rolled parsing, and the schemas double as the contract's
documentation.

## Screens

**`/` — Dashboard.** Struggling habits first, as a warning band with *Move to Upcoming*. Then
one block per active habit: name, current streak, 14-day rate, and its activity grid. The server always returns the full range; on a narrow screen the grid scrolls horizontally
inside its own container rather than dropping weeks, so the page body never scrolls sideways.
Tapping any square navigates to `/log?date=YYYY-MM-DD`.

**`/log` — Record a day.** Date picker defaulting to today, never advancing past today, with
previous/next day arrows. One card per active habit:

- binary → checkbox
- quantity → number input with the unit as a suffix, and a one-tap button to fill the target
- notes enabled → textarea

A single *Save* for the whole day rather than autosaving each field, so a half-typed note is
never persisted.

**`/habits` — Manage.** Active list with health pills and *Move to Upcoming*; upcoming backlog
with *Activate* (carrying the soft nudge above); archived list; and a form to add a habit —
name, kind, unit, target, notes toggle, and whether it starts active or upcoming.

## Logic modules

Pure, DB-free, each with a co-located `.spec.ts`:

- `server/lib/date.ts` — extended with `nextDay`, `dateRange(from, to)`, `lastNDays(n, upTo)`,
  `isValidDateKey`; `currentStreak` updated per D-4
- `server/lib/level.ts` — `activityLevel(habit, entry)`
- `server/lib/consistency.ts` — thresholds, `completionRate`, `classifyHealth`

## Testing

TDD on the pure modules, which is where every interesting rule lives:

- level bucketing at each boundary, including `v = target`, `v = 0`, null target, binary habits
- completion rate with a partial window (habit younger than 14 days)
- health classification at each threshold boundary and inside the grace period
- streaks: unlogged today, gaps, month and year boundaries
- date range generation across month and year boundaries

Routes get thin integration coverage against a temporary SQLite file via `DATABASE_PATH`:
upsert round-trips, future-date rejection, status transitions setting `activatedAt`.

## Migration and seed

A Drizzle migration adds the new columns, drops `archived_at`, and backfills existing rows
(`kind = 'binary'`, `status = 'active'`, `activatedAt = date(created_at)` — `created_at` is a timestamp, `activated_at` is a day).

The seed replaces the three starters with the four real habits, all active:

| Name | Kind | Unit | Target | Notes |
|---|---|---|---|---|
| Exercise | binary | — | — | on |
| Code reading | quantity | minutes | 15 | off |
| Meditation | quantity | minutes | 5 | off |
| Record one video | binary | — | — | off |

The upcoming backlog starts empty; it fills as habits are added or demoted.

A new `pnpm db:reset` drops `data/habits.db*`, migrates, and seeds. The existing local data is
two throwaway ticks against seed habits, so this run resets rather than migrates.

## Out of scope

Auth and multi-user; reminders and notifications; charts beyond the activity grid; habit
reordering; hard deletion (archive instead); timezone travel — days are whatever the machine's
local calendar says.
