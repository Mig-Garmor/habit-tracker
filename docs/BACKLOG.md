# Backlog

Things worth doing, not yet designed. Nothing here is committed to — it exists so ideas survive
the conversation they came up in. Anything that graduates gets a spec in
`docs/superpowers/specs/` first.

---

## Per-week cadence (and what it exposes)

**The idea:** a habit declares how often it is meant to happen. Exercise is 4× a week, typically
Mon/Tue/Thu/Fri. A future "Upload video to YouTube" is 1× a week. Cadence then feeds the
staleness and under-performance judgement.

**This is not only a feature — it fixes a real flaw in what already ships.** The consistency
engine (`server/lib/consistency.ts`) assumes every habit is daily. `completionRate` divides
completed days by *every* eligible day in a trailing 14-day window, so:

| Habit | Done exactly as intended | Rate | Verdict today |
|---|---|---|---|
| Exercise | 4× per week | 0.57 | `steady` — **can never reach `consistent`** (needs 0.80) |
| Upload video | 1× per week | 0.14 | `struggling` — **permanently** nagged to park it (below 0.50) |

So a habit performed perfectly reads as mediocre, and a weekly habit is flagged as failing
forever. The warning band would tell you to give up on something you are doing right. That is
worse than having no warning at all, because it trains you to ignore it.

**What would have to change:**

- `habits` gains a cadence — at minimum "times per week". Possibly also specific weekdays, which
  is a different and stronger claim (Exercise on M/T/Th/F means Wednesday is not a miss).
- `completionRate` stops dividing by elapsed days and starts dividing by *expected* occurrences
  in the window. Weekday-specific cadence changes the denominator again: only the named days
  count as eligible.
- The activity grid needs to distinguish "not expected today" from "expected and missed" — today
  both render as level 0, which would be actively misleading once cadence exists.
- `currentStreak` needs rethinking entirely. A 4×/week habit has no consecutive-day streak; the
  meaningful unit becomes consecutive *weeks* that met cadence.
- D-1 ("performed means showed up") is unaffected. D-2 (shading by amount) is unaffected.

**Open questions for whenever this is designed:** does a habit done 5× on a 4× cadence count as
over-performing or just 100%? Does a missed Monday get made up by a Saturday, or is the weekday
schedule strict? Those two answers change most of the logic above.

---

## Operational — not code

- **Split the Neon branches.** Local `.env` and the Vercel project point at the *same* Neon
  branch, so the database holding the real habit history is also the one local development
  reads and writes. Two consequences: there is nowhere to try a schema change before it reaches
  the live app, and `pnpm db:reset` run locally would drop the real data — that script exists
  and works. Since deploys now migrate automatically (D-19), this matters more than it did.
  Branch `dev` off the current branch in Neon (copy-on-write, near-instant), point `.env` at
  `dev`, leave Vercel on the original.
- **Rotate the Neon password.** It was printed into a session transcript on 2026-09-13 by a
  masking bug — a `sed` that replaced from the first `=`, which fell inside `sslmode=` rather
  than the password. The transcript is on disk. The database is now reachable from a public
  URL, so this is worth doing regardless of how unlikely exposure is.

---

## Smaller, already identified

- **Habits rows break badly at narrow widths.** The row is a horizontal flex, so as the window
  shrinks the `⋯` menu wraps onto its own line below the content — the one control that must
  always be reachable is the first thing to move. The cadence and target text is squeezed out
  before that.
  Wanted: below some width the row switches from horizontal to vertical, so the name is on top
  and the facts sit beneath it, while the `⋯` stays pinned to the top right. A breakpoint rather
  than `flex-wrap`, so every row breaks at the same width and the list stays uniform — wrapping
  would reflow each row differently depending on how long its name and unit happen to be, which
  is the inconsistency this is meant to avoid.
  The dashboard already solved the same problem by stacking text beside a fixed-width grid;
  worth reusing that thinking rather than inventing a second answer.

- **`kind`, `unit` and `notesEnabled` still cannot be edited.** `/habits` now edits a habit's
  name, target and cadence behind its Edit action, but not these three. `notesEnabled` is the
  one that bites: notes browsing exists, and there is no way to switch notes on for a habit that
  was created without them. Changing `kind` is the awkward one — a quantity habit turned binary
  has values recorded against it that stop meaning anything, so it needs a decision rather than
  a form field.
- **Notes hidden by their own flag.** `LogHabitCard` renders the note field only when
  `notesEnabled` is true, so turning the flag off hides an existing note rather than showing it
  read-only. Still latent because nothing in the UI can turn the flag off — but it stops being
  latent the moment the item above is built, and the notes page would then show notes the log
  screen refuses to display.

---

## Phases already specced

Phases 2 and 3 of `docs/superpowers/specs/2026-09-13-hosted-migration-design.md` — Google
sign-in restricted to one email, then the Vercel deploy. Designed, not built.
