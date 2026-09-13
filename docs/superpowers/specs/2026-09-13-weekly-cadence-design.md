# Weekly cadence — design

> Status: approved, not yet implemented
> Date: 2026-09-13

## Why

The consistency engine assumes every habit is daily. `completionRate` divides completed days by
*every* eligible day in a trailing 14-day window, so a habit performed exactly as intended still
scores badly:

| Habit | Kept perfectly | Rate | Verdict |
|---|---|---|---|
| Exercise, 4× a week | 4 every week | 0.57 | `steady` — **cannot reach** `consistent` (needs 0.80) |
| Upload video, 1× a week | 1 every week | 0.14 | `struggling` — **permanently** |

This is not a missing feature. It is a defect that makes the app lie. The warning band would tell
you to give up on something you are doing right, which is worse than having no warnings at all,
because it teaches you to ignore them.

## Decisions

**D-20 — cadence is a count per week, not a set of weekdays.** A habit declares `timesPerWeek`.
It does not declare *which* days. Naming weekdays would be a stronger claim — it would let the
grid say "Wednesday was never expected" — but it is the wrong claim here: the count is the
commitment and the days are incidental ("4 times a week, typically M/T/Th/F"). A weekday schedule
would also mean training on Saturday instead of Monday reads as one miss plus one unplanned
extra, which is false.

The cost is accepted deliberately: with no per-day expectation, nothing can know whether *today*
was expected, so no individual square can be labelled "not expected". D-23 handles that.

**D-21 — a week counts only if it is complete and fully elapsed since activation, unless it has
already met cadence, in which case it counts anyway.** One rule, covering the two awkward weeks:

- The week in progress. Scoring it pro-rata would mean every habit reads as failing each Monday
  — the loudest signal the app can send, and wrong. Doing all four sessions Thursday to Sunday is
  a perfectly good 4× week.
- The week a habit was activated. Half a week of opportunity judged against a full week's cadence
  would punish the habit for when it happened to be created.

Both can lift the score and neither can lower it. The rule is deliberately generous; the
alternative is a number that is technically defensible and practically ignored.

**D-22 — each week is capped at 100%; extra sessions do not carry.** Six sessions one week and
two the next is 75%, not 100%. Each week is its own commitment: this measures consistency, and a
heavy week must not paper over a light one. Volume is still visible in the grid, which shows
every session. Rejected: pooling completions across the window, which scores an all-or-nothing
pattern the same as a steady one.

**D-23 — the grid keeps daily squares and gains a week-level marker.** Every square stays one
day, shaded exactly as it is now (D-2 is untouched). Week columns that met cadence are marked.

A blank square means "nothing logged" and nothing more. That is now *true*: under D-20 no day
was individually expected, so a blank cannot mean "missed". Rejected: one square per week, which
matches the scoring exactly but throws away the daily texture that makes the grid worth looking
at, and leaves per-day amounts and notes with nowhere to live. Also rejected: dimming "still
owed" slots in the current week, which has to invent *which* days are owed — information D-20
deliberately does not have.

**D-24 — the window is four complete weeks, replacing the rolling fourteen days.** Fourteen days
gives a 1×/week habit two data points, which cannot support a judgement. Four weeks gives four.

This shifts the numbers on existing daily habits: same thresholds, same spirit, but a rate
computed over four complete weeks rather than a rolling fortnight will not be identical to
today's. Accepted knowingly — one scoring model for all cadences is worth more than continuity
of a number that was wrong for any non-daily habit anyway.

**D-25 — a streak is consecutive weeks that met cadence.** Consecutive days are meaningless for a
4×/week habit. The current week counts only once it has met cadence, and its not having done so
yet does not break the streak — the same tolerance D-4 gives an unlogged today.

**D-26 — a daily habit is cadence 7.** `timesPerWeek` defaults to 7, so every existing habit
already has a correct cadence the moment the column exists, and no code path needs a "daily"
special case. Rejected: a nullable column meaning "daily", which would put a null check in every
calculation forever.

## Data model

```
habits.times_per_week  integer  NOT NULL  DEFAULT 7   -- 1..7
```

Validated 1–7 at the edge, as `habitKinds` and `habitStatuses` are (D-7: enums live in TypeScript
and Zod, not in Postgres types).

## Scoring

```
weekScore(week)  = min(1, completedDaysInWeek / timesPerWeek)
countedWeeks     = weeks in the trailing 4 complete weeks that satisfy D-21
                   + the current week and the activation week, if they met cadence
rate             = mean(weekScore) over countedWeeks, or 0 when there are none
```

Weeks start on the same boundary the grid already uses (`startOfWeek`), so the marker in D-23
lines up with the columns rather than inventing a second definition of "week".

`classifyHealth` keeps its thresholds — `struggling` below 0.5, `consistent` at or above 0.8 —
and keeps returning `new` during the grace period. Grace becomes **two complete weeks** since
activation, replacing 14 days, so it is expressed in the same unit as everything else.

## API

`GET /api/dashboard` gains, per habit:

```ts
weeks: { start: string, completed: number, expected: number, met: boolean }[]
```

`days` is unchanged. `rate`, `health` and `streak` keep their names and types; only their
derivation changes. `GET /api/habits`, `POST /api/habits` and `PATCH /api/habits/:id` carry
`timesPerWeek`.

## UI

- The add-habit form gains a cadence control, defaulting to 7 (daily).
- `/habits` shows and edits cadence per habit, in the row that already holds the target.
- The dashboard marks week columns that met cadence, and states cadence next to the habit name
  so the rate is interpretable ("4× a week — 100%").

## Testing

- `completionRate` against each decision above: a 4×/week habit kept exactly scores 1.0; a
  1×/week habit kept exactly scores 1.0; a partial current week never lowers the rate; a week
  that over-delivers scores 1.0 and does not compensate the next; the activation week is excluded
  unless met.
- `currentStreak` counts weeks, tolerates an unmet current week, and breaks on a missed one.
- Route tests asserting `weeks` appears and agrees with `days`.
- The existing daily-habit tests stay, adjusted for D-24 where the window change moves a number.

## Non-goals

- Weekday schedules, and anything that depends on knowing whether a *particular* day was expected.
- Reminders or notifications.
- Changing D-1 (performed means showed up) or D-2 (shading by amount). Both are unaffected.
