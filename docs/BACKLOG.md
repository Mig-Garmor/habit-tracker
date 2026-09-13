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

## Smaller, already identified

- **Export/backup script.** A hosted database has durability, but free tiers keep limited
  history (Neon's free tier is about 7 days) and free providers do sunset. A `pnpm db:export`
  writing JSON is cheap insurance. Was urgent when data lived in one gitignored SQLite file;
  became non-urgent once hosted, never became unnecessary.
- **Somewhere to read notes back.** Notes on Exercise are only visible by opening the exact day
  that has one, and the grid does not even hint that a note exists. Writing them is easy;
  browsing them is not possible. Mark days that carry a note, and offer a reverse-chronological
  list per habit.
- **Rename is the only edit.** A habit's name and target can be changed from `/habits`; its
  `kind`, `unit` and `notesEnabled` cannot. Deliberate — a fuller edit form deserves its own
  design pass rather than growing by accretion.
- **Notes hidden by their own flag.** `LogHabitCard` renders the note field only when
  `notesEnabled` is true, so turning the flag off hides an existing note rather than showing it
  read-only. Latent: nothing in the UI can turn the flag off yet.

---

## Phases already specced

Phases 2 and 3 of `docs/superpowers/specs/2026-09-13-hosted-migration-design.md` — Google
sign-in restricted to one email, then the Vercel deploy. Designed, not built.
