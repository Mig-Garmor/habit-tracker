# Today view and daily schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clock-driven Today view at `/` with Morning (work) and Evening (personal) slots, backed by habit slots, weekdays, questions, checklist and journal kinds.

**Architecture:** Pure scheduling/progress logic in `server/lib/schedule.ts` and entry derivation in `server/lib/entry-rules.ts`; a new `GET /api/today/:date` route builds the payload; the browser decides the front slot from its own clock (`src/lib/day-part.ts`). Ticks reuse `PUT /api/log/:date` with single-entry bodies.

**Tech Stack:** Vue 3 + vue-router auto-routes, Hono, Drizzle (Neon in prod, PGlite in tests), Zod, Vitest + @vue/test-utils.

**Spec:** `docs/superpowers/specs/2026-11-03-today-view-design.md`

## Global Constraints

- Days are local `YYYY-MM-DD` text keys (D-8); weekday numbers are ISO, 1 = Monday … 7 = Sunday.
- `slot` ∈ `morning | evening`, default `evening`. `weekdays` default `[1,2,3,4,5,6,7]`, unique ints 1–7, at least one.
- `kind` ∈ `binary | quantity | checklist | journal`; enums live in TS + Zod, never a Postgres enum (D-7).
- `question` ≤ 200 chars, nullable. Step label 1–80 chars; ≤ 20 steps per habit.
- `EVENING_STARTS_AT = 17` in `src/lib/day-part.ts`.
- Journal autosave: on blur and after 800 ms idle.
- Never run migrations or scripts against `.env`'s `DATABASE_URL` — it is production. Tests use PGlite only.
- Match the repo's comment style (it explains decisions by D-number); scoped SCSS file per component.
- Rewrite tests broken by moves; never delete them.

## Review Focus

1. Typing in a journal then navigating away within 800 ms — the pending save must flush on unmount (Task 8 test).
2. A checklist with zero steps must still be tickable as a plain tick (Task 3 test).
3. Page left open past midnight must reload for the new day (Task 8 test).
4. A stale page sending a step id that was since deleted gets a 400 with a readable message, not a 500 (Task 3 test).
5. A failed single tick reverts only that control (Task 8 test).

---

### Task 1: Schema and migration

**Files:**
- Modify: `server/db/schema.ts`
- Create: `drizzle/0003_*.sql` (+ meta) via `pnpm db:generate`

**Interfaces:**
- Produces: `habitKinds = ['binary','quantity','checklist','journal']`, `habitSlots = ['morning','evening']`, types `HabitSlot`, `HabitStep`; columns `habits.slot`, `habits.weekdays: number[]`, `habits.question`, `habitEntries.steps: number[] | null`; table `habitSteps { id, habitId, label, position }`.

- [ ] Add the columns/table exactly as the spec's Data model; `weekdays` uses `integer('weekdays').array().notNull().default(sql\`'{1,2,3,4,5,6,7}'\`)`.
- [ ] `pnpm db:generate` (generates SQL only — does not touch any database). Check the SQL matches the spec's block.
- [ ] `pnpm test` — all 356 still pass (harness migrates PGlite).
- [ ] Commit `feat(db): habit slot, weekdays, question, steps`.

### Task 2: Scheduling and progress logic

**Files:** Create `server/lib/schedule.ts`, `server/lib/schedule.spec.ts`

**Interfaces:**
- Produces:
  - `isoWeekday(date: string): number`
  - `isScheduled(habit: { weekdays: number[] }, date: string): boolean`
  - `owedFrom(habit: { weekdays: number[], timesPerWeek: number }, date: string, completedDates: Iterable<string>): string | null` — the earliest scheduled day earlier this week that is still unmet, per D-31; `null` if not owed.
  - `habitProgress(habit: ProgressHabit, entry: ProgressEntry | null): number` (D-33)
  - `slotProgress(items: { progress: number, completed: boolean }[]): { progress: number, done: number, total: number }` — mean progress; empty slot → `{ progress: 0, done: 0, total: 0 }`.

- [ ] Tests: Monday-only habit owed Tue–Sun after an unlogged Monday, returns `'<monday>'`; not owed once completed on Tuesday; not owed on Monday itself; Mon–Fri ×5 habit missing Mon+Tue on Wednesday → owed from Monday; `timesPerWeek` cap (all-7 weekdays, ×4, done 4 by Thu → not owed); progress: binary 0/1, quantity 7.5/15 → 0.5, quantity over target → 1, checklist 2 of 5 → 0.4, checklist with 0 steps → 0/1 from completed, journal 0/1.
- [ ] Run `pnpm vitest run server/lib/schedule.spec.ts` → FAIL, implement, → PASS.
- [ ] Commit `feat(api): scheduling and slot progress`.

### Task 3: Entry rules and the log route

**Files:** Create `server/lib/entry-rules.ts` (+ spec); modify `server/routes/log.ts`, `server/validation.ts`, `server/lib/level.ts`, `server/lib/dashboard.ts` (kind union), `server/routes/log.spec.ts`.

**Interfaces:**
- Produces: `deriveEntry(habit: { kind, notesEnabled }, stepIds: number[], input: LogEntryInput, existing: StoredEntry | null): { completed, value, note, steps }` throwing `EntryRuleError(message, 400)` for a foreign step id. `logEntrySchema.steps: number[]` optional. GET `/api/log/:date` habits carry `slot`, `steps: {id,label}[]`, `entry.steps`.
- Rules: binary unchanged; quantity unchanged; checklist with steps → `steps` = given (or stored when omitted) ∩ habit's ids, `value = steps.length`, `completed = value > 0`; checklist without steps → binary; journal → note (merged as D-6), `completed = !!note`, `value = null`. `activityLevel` treats checklist like quantity (target = step count).

- [ ] Tests (route): checklist ticks 2 of 5 → value 2, completed; omitted `steps` keeps stored ticks; foreign id → 400 with message `Step 99 does not belong to habit N`; zero-step checklist ticks with `completed: true`; journal with text completed, cleared → not completed; level for checklist 2/5 = 1, 5/5 = 3.
- [ ] FAIL → implement → PASS; full `pnpm test` green.
- [ ] Commit `feat(api): checklist and journal entries`.

### Task 4: Habits route — fields, kind rule, steps

**Files:** Modify `server/routes/habits.ts`, `server/validation.ts`, `server/routes/habits.spec.ts`.

**Interfaces:**
- Produces: create/update accept `slot`, `weekdays`, `question`; journal forces `notesEnabled: true`; PATCH rejects kind change involving checklist/journal (400 `A checklist or journal habit cannot change kind`); `GET /api/habits` rows include `steps: {id,label,position}[]` ordered by position; `PUT /api/habits/:id/steps` body `{ steps: { id?: number, label: string }[] }` → `{ habit }` (with steps), sets `habits.target = steps.length`, removes deleted ids from that habit's `habit_entries.steps` (value untouched); non-checklist → 400; unknown id in body → 400.

- [ ] Tests for each produced behaviour, including weekdays validation (`[]`, `[0]`, `[1,1]` → 400) and question length 201 → 400.
- [ ] FAIL → implement → PASS. Commit `feat(api): slots, weekdays, questions and steps on habits`.

### Task 5: Today route

**Files:** Create `server/routes/today.ts`, `server/routes/today.spec.ts`; modify `server/app.ts` (mount at `/api/today` behind the session middleware, like `/api/log`).

**Interfaces:**
- Consumes: Task 2 functions.
- Produces `GET /api/today/:date` → `TodayResponse`:
  `{ date, weekday, morningVisible, slots: { morning: TodaySlot, evening: TodaySlot } }`,
  `TodaySlot = { habits: TodayHabit[], progress, done, total }`,
  `TodayHabit = { id, name, kind, unit, target, notesEnabled, question, timesPerWeek, steps: {id,label}[], carriedFrom: string | null, progress, entry: { completed, value, note, steps } | null }`.
  Invalid date → 400; future date → 400 (same messages as `/api/log`). Habits ordered by position, id. `morningVisible = weekday <= 5`; when false, `slots.morning.habits` is empty.

- [ ] Tests: Monday lists Plan-the-week; Tuesday after an unlogged Monday lists it with `carriedFrom` = Monday; Saturday hides morning; evening habits default-slot listed every day; progress/done/total for a mixed slot.
- [ ] FAIL → implement → PASS. Commit `feat(api): today endpoint`.

### Task 6: Client types and day-part

**Files:** Modify `src/lib/api.ts`; create `src/lib/day-part.ts`, `src/lib/day-part.spec.ts`.

**Interfaces:**
- Produces: TS types mirroring Tasks 3–5 (`HabitKind` four kinds, `HabitSlot`, `HabitStep`, `TodayResponse`, `TodayHabit`, `TodaySlot`); `fetchToday(date)`, `saveSteps(id, steps)`; `Habit` gains `slot`, `weekdays`, `question`, `steps`.
- `frontSlot(now: Date): 'morning' | 'evening'`, `morningVisible(now: Date): boolean`, `dateKey(now: Date): string`, `EVENING_STARTS_AT`.

- [ ] Tests: Fri 16:59 morning, Fri 17:00 evening, Sat 09:00 evening + morning hidden, Mon 00:00 morning.
- [ ] FAIL → implement → PASS. Commit `feat(web): day-part and today client`.

### Task 7: Move the dashboard to /progress

**Files:** `git mv src/pages/index.vue src/pages/progress.vue`, same for `.scss` and `.spec.ts`; modify `progress.vue` to group habits under "Morning"/"Evening" headings (only headings for non-empty slots); `server/lib/dashboard.ts` input/output carries `slot`; `src/App.vue` nav: brand → `/` (Today), links Progress, Log, Habits.

- [ ] Existing spec cases keep passing from the new file; add one: habits split under Morning and Evening headings in position order.
- [ ] Commit `feat(web): dashboard moves to /progress, grouped by slot`.

### Task 8: Today view

**Files:** Create `src/pages/index.vue` (+ `.scss`, `.spec.ts`), `src/components/TodayHabit.vue` (+ `.scss`), `src/components/SlotBar.vue` (+ `.scss`).

**Interfaces:**
- `TodayHabit` props `{ habit: TodayHabit, date: string }`, emits `saved()` (no payload) after a successful save; it calls `saveLog(date, [entry])` itself and owns its optimistic state + revert.
- `SlotBar` props `{ label: string, progress: number, done: number, total: number }`, emits `expand`; renders a `role="progressbar"` with `aria-valuenow` = rounded percent.
- Page: `now` ref refreshed every 60 s; `front` = manual override ?? `frontSlot(now)`; override clears when `frontSlot(now)` changes; reload when `dateKey(now)` changes; after any save, refetch `/api/today` to refresh bars.

- [ ] Tests (mock `@/lib/api`, `vi.useFakeTimers()` + `setSystemTime`): Tue 09:00 Morning expanded, Evening bar shows "1 of 3 done"; Tue 18:00 reversed; Sat shows no Morning bar; clicking a bar brings it forward; ticking a binary sends exactly one entry; a rejected save restores the checkbox and shows the message; journal typing saves once after 800 ms and flushes on unmount; advancing past midnight refetches with the new date; carried habit shows "from Monday"; question text rendered.
- [ ] FAIL → implement → PASS. Commit `feat(web): Today view with morning and evening slots`.

### Task 9: /log learns the new kinds

**Files:** Modify `src/components/LogHabitCard.vue`, `src/pages/log.vue`.

- [ ] Checklist renders a checkbox per step (zero steps → single tick); journal renders the textarea with no tick; `save()` sends `steps` for checklists and `note` for journals. Add a `LogHabitCard` spec for both.
- [ ] Commit `feat(web): log checklist and journal habits`.

### Task 10: Habit editor

**Files:** Modify `src/pages/habits.vue` (+ `.scss`), add `src/pages/habits.schedule.spec.ts`.

- [ ] Create form: kind select (Tick, Amount, Checklist, Journal), slot select, seven weekday toggles (Mon–Sun, all on by default), question input. Edit mode adds slot, weekdays, question and — for checklists — a steps list (rename inline, add, remove, move up/down) saved with one `saveSteps` call alongside the PATCH. Summary line shows slot and weekdays when not every day (e.g. "morning · Mon–Fri · 5× / week").
- [ ] Tests: create sends slot/weekdays/question; editing steps sends the whole ordered list; kind select is not offered when editing a checklist/journal.
- [ ] Commit `feat(web): edit slots, weekdays, questions and steps`.

### Task 11: Seed the work routine and document

**Files:** Create `scripts/seed-work-routine.ts`; modify `package.json` (`db:seed:routine`, `db:seed:routine:prod`), `README.md`, `docs/BACKLOG.md`.

- [ ] Script inserts the spec's four habits (skipping any whose name already exists), with steps and questions, `status: 'active'`, `activatedAt: today()`. Do **not** run it.
- [ ] README: Today/Progress pages, new commands, the D-29 table. BACKLOG: weekday visibility shipped (D-27); MCP is part 2.
- [ ] `pnpm typecheck && pnpm test && pnpm build` all pass. Commit `feat: seed the morning work routine; docs`.
