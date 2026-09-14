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

## Before it is open to other people

None of this is urgent while `ALLOWED_EMAILS` holds the door shut — the allowlist is
re-checked on every request, so today there is exactly one account and it belongs to us. Each
item below becomes real the moment that list grows, and all three are cheaper to design now
than to retrofit under load.

### Limits on what one account can write

**Start from what already exists**, because the obvious version of this item is already built
and the remaining gap is a different shape than it first appears:

| Bound | Where | Value |
|---|---|---|
| Habit name | `server/validation.ts` | 80 chars |
| Unit | `server/validation.ts` | 20 chars |
| Note | `server/validation.ts` | 2000 chars |
| Entries per request | `logPayloadSchema` | 100 |
| Rows per habit per day | `habit_entries_habit_date_idx` | exactly 1 |

That last row is the important one. Entries are **upserted** against a unique index on
`(habit_id, date)`, so backfilling previous days — the scenario that prompted this item — cannot
add rows without bound. Re-logging 2026-01-01 a thousand times leaves one row. Row growth is
`habits × distinct days`, not `requests`.

**So the unbounded quantities are elsewhere:**

- **Habit count.** Nothing caps how many habits an account creates. Since rows scale with
  `habits × days`, this is the actual multiplier — 10,000 habits makes every past day storable
  10,000 times over, and it is the only input that moves that number.
- **Request rate.** There is no rate limiting on any route. Upserts are cheap per call but not
  free, and `PUT /api/log/:date` can be called as fast as the network allows.
- **Total text.** 2000 chars is reasonable for one note and unreasonable as
  `habits × days × 2000`.
- **Read cost.** `GET /api/dashboard` runs `db.select().from(habitEntries)` with **no `WHERE`**
  — every entry ever written, on every dashboard load. Deliberate (the streak has no depth cap,
  see the comment there), but it means read cost grows with total history, not with what is
  displayed. This is the item most likely to bite first, and it is shared with the caching items
  below.

**Open question for whenever this is designed:** a per-account habit cap is the single highest-
value limit and the most annoying to get wrong — too low and a legitimate user hits it, too high
and it does not bound anything. It probably wants to be generous (say 100) and enforced at
creation, rather than clever.

### Caching what the server sends

`GET /api/dashboard` recomputes everything on every load: all entries fetched, then shading,
streak, rate, health and week summaries derived per habit. For one user this is fine. It is also
entirely deterministic given `(habits, entries, today)`, which makes it a natural thing to cache
and invalidate on write — every mutation already goes through the log and habits routes, so
there is one obvious place to bust it.

Worth pairing with bounding the entry fetch above; caching an unbounded query hides the growth
rather than fixing it.

### Caching what the browser re-asks for

No response in the app sends `Cache-Control`, an `ETag`, or any other validator — verified, the
strings appear nowhere in `server/`. Every navigation refetches everything from scratch, and the
dashboard is refetched in full after every park.

The cheap win is conditional requests: an `ETag` on the dashboard payload turns an unchanged day
into a 304 with no body. The dashboard is the right first target because it is the largest
response and the one most often re-requested unchanged.

**Care needed:** these responses are per-account and sit behind a session cookie, so anything
added here has to be `private` and must not become shared-cache eligible. Getting that wrong
leaks one person's habits to another — which is a strictly worse failure than the slowness it
was meant to fix.

---

## Smaller, already identified

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
