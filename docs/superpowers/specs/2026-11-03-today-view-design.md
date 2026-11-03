# Today view and daily schedule — design

> Status: approved in conversation 2026-11-03; spec written for review after the fact
> Date: 2026-11-03
> Part 1 of 3. Part 2 is an MCP server over this data; part 3 (the "what needs attention"
> review) ships inside part 2 as a prompt.

## Why

Every habit today is one flat list, shown the same way at 8am on a Tuesday and at 3pm on a
Sunday. The work day and the evening want different things in front of you:

- **Mornings, Monday to Friday**, are work routines — plan the week on Monday, check in on the
  team, recap initiatives, and write down what got done.
- **Evenings after work, and the whole weekend**, are the personal habits that already exist.

The app should put the right group in front at the right time, keep the other one visible as a
single completion bar, and let you tick things off right there.

## What ships

1. A **Today** view at `/` with a Morning and an Evening section. The clock decides which one is
   in front; the other collapses to a completion bar. Ticks save immediately.
2. The existing dashboard moves to **`/progress`**, unchanged apart from grouping by slot.
3. Habits gain a **slot**, a set of **weekdays**, and an optional **question**.
4. Two new habit kinds: **checklist** (ordered steps) and **journal** (a note that is the habit).
5. A seed script that creates the four morning work habits.

## Decisions

Numbering continues from the weekly-cadence spec (D-20…D-26).

**D-27 — weekdays decide where a habit appears, never how it is scored.** A habit gains
`weekdays` (ISO numbers, 1 = Monday … 7 = Sunday; all seven by default). The Today view uses it
to decide which day a habit is listed on. Scoring stays exactly as D-20…D-26 define it:
cadence is `timesPerWeek`, judged per week. "Plan the week" is `weekdays [1]`, `timesPerWeek 1`;
doing it on Tuesday still meets the week. D-20's objection to weekday schedules was about
*scoring* — a weekday that only controls visibility cannot turn a Saturday session into a miss.

**D-28 — every habit belongs to one slot: `morning` or `evening`.** Existing habits default to
`evening`, so nothing moves until a habit is explicitly put in the morning.

**D-29 — the clock picks the front slot.**

| When | In front | Collapsed |
|---|---|---|
| Mon–Fri, before 17:00 | Morning | Evening bar |
| Mon–Fri, from 17:00 | Evening | Morning bar |
| Sat–Sun, all day | Evening | *(no Morning at all)* |

The switch hour is one constant, `EVENING_STARTS_AT = 17`, in `src/lib/day-part.ts`. Tapping a
collapsed bar brings that slot to the front until the next automatic switch or a reload. The
front slot is computed in the browser from the browser's clock — the server never guesses the
time of day.

Weekends hide Morning entirely, including any morning habit carried over (D-31): there is no
work to do on a Saturday, and an empty or nagging bar would be noise.

**D-30 — a checklist habit has ordered steps; ticking steps shades the day.** Steps live in a
new `habit_steps` table with their own ids. A day's entry stores the ids that were ticked
(`habit_entries.steps`). The server keeps two existing fields in step:

- `habit.target` = the habit's current number of steps, rewritten whenever steps change.
- `entry.value` = how many steps were ticked that day.

That makes a checklist shade exactly like a quantity habit (D-2) with no new grid logic, and,
like raising a quantity target, adding a step re-shades history without rewriting it.
`completed` = at least one step ticked — D-1's "showed up" rule, chosen explicitly. The
completion bar (D-33) still counts steps, so 2 of 5 reads as partial there.

A checklist may also have notes enabled — "Plan the week" uses its note for the week's
objectives, which part 2 reads back.

**D-31 — a habit owed this week carries over to later days of its slot until done.** On a given
day, a habit is listed if it is scheduled that weekday, *or* if it is **owed**: at least one of
its scheduled weekdays earlier this week has passed and its completions so far this week are
fewer than the occurrences that have passed (capped at `timesPerWeek`). Only a habit listed
because it is owed — not scheduled today — is labelled with the earliest unmet scheduled day
("from Monday"); a habit scheduled today is listed plainly whatever it owes. Morning carry-over only appears on weekdays
(D-29).

**D-32 — a journal habit is done when its note has text.** No tick. Saving text completes the
day; clearing it un-completes it. Notes are always on for a journal habit. `/notes` already lists
a habit's notes newest first, so a week of "what did I do today" is browsable there.

**D-33 — the completion bar is the mean progress of the habits listed for that slot today.**

| Kind | Progress |
|---|---|
| binary, journal | 0 or 1 |
| quantity | `min(1, value / target)` |
| checklist | ticked ÷ steps (0 or 1 if it has no steps) |

The bar shows the percentage and "n of m done", where done means `completed`.

**D-34 — `/` is Today; ticks save one habit at a time.** Each tick, step or quantity change sends
a single-entry `PUT /api/log/:date`; a journal saves on blur and after 800 ms of no typing. The
dashboard moves to `/progress`; `/log` stays for back-filling past days and learns the two new
kinds.

**D-35 — steps are edited as a whole list.** `PUT /api/habits/:id/steps` takes the complete,
ordered list (`{ id?, label }`); ids present are renamed and reordered, ones without an id are
created, missing ones are deleted. Same idempotent whole-list shape as `/reorder`. Deleting a step
removes its id from that habit's past entries' `steps` but leaves their `value` alone, so history
keeps its shading.

**D-36 — a habit may carry a question.** Optional, up to 200 characters, e.g. "Is anyone
blocked, or carrying more than two COS tickets?". The Today view shows it under the habit; part 2's
"list questions" tool reads it.

**D-37 — a habit's kind can change only between binary and quantity.** Converting to or from a
checklist or journal would orphan steps or notes-as-completion; the API rejects it with 400.
Create a new habit instead.

## Data model

Migration `0003`:

```sql
ALTER TABLE habits ADD COLUMN slot text DEFAULT 'evening' NOT NULL;
ALTER TABLE habits ADD COLUMN weekdays integer[] DEFAULT '{1,2,3,4,5,6,7}' NOT NULL;
ALTER TABLE habits ADD COLUMN question text;
ALTER TABLE habit_entries ADD COLUMN steps integer[];
CREATE TABLE habit_steps (
  id serial PRIMARY KEY,
  habit_id integer NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  label text NOT NULL,
  position integer DEFAULT 0 NOT NULL
);
```

`kind` gains `checklist` and `journal` (TypeScript + Zod only, per D-7 — no Postgres enum).

## API

| Route | Change |
|---|---|
| `GET /api/today/:date` | **New.** Both slots for that day: listed habits with entry, steps, `carriedFrom`, question; per-slot `progress`, `done`, `total`; `morningVisible` (false at weekends). |
| `PUT /api/log/:date` | Entries accept `steps: number[]`. Server derives `value`/`completed` per D-30/D-32. An omitted `steps` keeps the stored ticks, as an omitted `note` does (D-6). Step ids not belonging to the habit → 400. |
| `GET /api/log/:date` | Each habit also returns `steps`, `entry.steps`, `slot`. |
| `POST/PATCH /api/habits` | Accept `slot`, `weekdays`, `question`, the new kinds. A journal forces `notesEnabled = true`. D-37 enforced on PATCH. |
| `GET /api/habits` | Each habit includes its `steps`. |
| `PUT /api/habits/:id/steps` | **New**, D-35. Rejected for non-checklist habits. |
| `GET /api/dashboard` | Habits carry `slot`; client groups by it. |

Validation: `weekdays` is 1–7 unique integers, at least one; `question` ≤ 200; a step label 1–80;
at most 20 steps.

## Units

| Unit | Responsibility |
|---|---|
| `server/lib/schedule.ts` | Pure: weekday of a date key, `isScheduled`, `owedFrom` (D-31), `habitProgress`, `slotProgress` (D-33). |
| `server/lib/entry-rules.ts` | Pure: derive `completed`/`value` for any kind from input + stored entry (D-1, D-30, D-32). The log route calls it instead of inlining the rule. |
| `server/routes/today.ts` | Loads active habits, their steps and this week's entries; builds the payload with `schedule.ts`. |
| `server/routes/habits.ts` | Steps endpoint, new fields, D-37. |
| `src/lib/day-part.ts` | Pure: `frontSlot(now)` and `nextSwitch(now)` (D-29). |
| `src/pages/index.vue` | Today view: clock tick each minute, reload when the date changes, front slot + collapsed bar. |
| `src/components/TodayHabit.vue` | One habit row: tick / amount / steps / journal text, emits a single-entry save. |
| `src/components/SlotBar.vue` | The collapsed completion bar; click to bring forward. |
| `src/pages/progress.vue` | The current dashboard, moved, grouped by slot. |
| `src/components/LogHabitCard.vue` | Learns checklist steps and journal text for `/log`. |
| `src/pages/habits.vue` | Create/edit: kind (four), slot, weekdays, question; steps editor for checklists. |
| `scripts/seed-work-routine.ts` | Idempotent by name; creates the four morning habits below. |

## The morning habits (seed)

| Name | Kind | Weekdays | ×/wk | Notes | Steps / question |
|---|---|---|---|---|---|
| Plan the week | checklist | Mon | 1 | on (objectives) | Check tasks in progress (team and mine) · Check available tasks · Check open PRs in catena-unicorn · Order the tasks to tackle · Decide the end-of-week target. Q: "What has to be finished by Friday, and in what order?" |
| Check what each team member is working on | checklist | Mon–Fri | 5 | off | No steps — you add teammates' names. Q: "Is anyone blocked, or carrying more than two COS tickets?" |
| Recap team initiatives | journal | Mon–Fri | 5 | — | Q: "Which initiatives moved since yesterday, and which stalled?" |
| What did I do today | journal | Mon–Fri | 5 | — | Q: "What did I ship, unblock or decide today?" |

The script runs locally against whatever `DATABASE_URL` says and is never run automatically on
deploy; `pnpm db:seed:routine:prod` exists for when you choose to.

## Error handling

- Today view: a failed tick reverts that one control and shows the server's message inline; the
  other habits are untouched (each save is independent).
- A journal save that fails keeps the typed text in the textarea and shows "Not saved — retry".
- Date rollover while the page is open (past midnight) reloads the payload for the new day.

## Testing

- Unit: `schedule.ts` (scheduled, owed/carry-over across a week, progress per kind), `entry-rules.ts`,
  `day-part.ts` (boundaries: Fri 16:59/17:00, Sat, Sun, Mon 00:00).
- Route (PGlite): `/api/today` lists by weekday and carry-over and hides Morning at weekends;
  `/api/log` checklist/journal derivation, omitted-steps preservation, foreign step id → 400;
  steps whole-list PUT (create/rename/reorder/delete, target follows count, past entries lose the
  deleted id but keep value); D-37.
- Component: Today view front slot by mocked clock, collapsed bar shows the completion, a tick
  sends one entry; `progress.spec.ts` carries over every existing `index.spec.ts` case.
- The existing 356 tests stay green; tests broken by the move are rewritten to the new location,
  not deleted.

## Out of scope

- The MCP server, tokens and the `/start-ht` skill (part 2).
- Configurable switch hour in the UI; slots other than morning/evening.
- Per-step notes (teammate notes) — considered and declined in favour of plain step ticks.
