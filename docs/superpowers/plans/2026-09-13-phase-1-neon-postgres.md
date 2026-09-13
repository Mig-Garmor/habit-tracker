# Phase 1 — Neon Postgres Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the habit tracker's data layer from a local SQLite file to Neon Postgres, with the whole test suite still running offline.

**Architecture:** The schema moves from `sqliteTable` to `pgTable` and the driver from `better-sqlite3` to `@neondatabase/serverless`'s `Pool` via `drizzle-orm/neon-serverless`. Because Postgres Drizzle is asynchronous, every route handler that touches the database becomes `async` and all 13 `.all()`/`.get()`/`.run()` calls are awaited. The 33 route tests lose their temporary-SQLite-file trick and move to `pglite` — real Postgres in WASM, in-process — so `pnpm test` still runs with no network.

**Tech Stack:** Drizzle ORM, `@neondatabase/serverless`, `@electric-sql/pglite`, Hono, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-13-hosted-migration-design.md` — read it alongside this plan. Decisions D-7 through D-14 are binding, as are D-1 through D-6 from the original design spec.

## Global Constraints

- **The driver is `drizzle-orm/neon-serverless` (Pool), never `neon-http`** (D-14). `neon-http.transaction()` throws `No transactions support in neon-http driver`, and `PUT /api/log/:date` depends on a real transaction.
- **Dates stay strings.** The two day columns are `text`, not Postgres `date` (D-8). Never introduce a type that returns `Date` objects for them.
- **Enums stay `text({ enum })`**, not `pgEnum` (D-7).
- **Tests must not need a network connection.** `pnpm test` runs entirely on pglite.
- `noUnusedLocals` and `noUnusedParameters` are on for `server/**` — an unused import is a build failure. The dialect swap orphans several imports; check every one.
- `pnpm typecheck` and `pnpm test` must pass before every commit.
- Binding behaviours that must survive unchanged: **D-1** (server derives `completed` from `value > 0` for quantity habits), **D-5** (a non-archived habit with an entry that day stays loggable), **D-6** (an omitted `note` preserves the stored one), and the atomicity of `PUT /api/log/:date`.

## File Structure

**Data layer:**
- `server/db/schema.ts` *(rewrite)* — `pgTable` definitions
- `server/db/client.ts` *(rewrite)* — Neon Pool + `drizzle-orm/neon-serverless`
- `drizzle.config.ts` *(modify)* — `postgresql` dialect, `DATABASE_URL`
- `drizzle/` *(delete and regenerate)* — existing SQL is SQLite DDL

**Routes — mechanical async conversion, no behaviour change:**
- `server/routes/dashboard.ts` (2 calls), `server/routes/habits.ts` (4), `server/routes/log.ts` (7)

**Tests:**
- `server/test/pg-harness.ts` *(create)* — builds a migrated pglite database; shared by both spec files so the setup exists once
- `server/routes/habits.spec.ts`, `server/routes/log.spec.ts` *(modify)* — swap the SQLite temp file for the harness

**Scripts and config:**
- `scripts/seed.ts`, `scripts/migrate.ts` *(modify)*, `scripts/reset.ts` *(create)*
- `package.json` *(modify)* — dependencies and `db:reset`
- `.env.example` *(create)*, `.gitignore` *(modify)*, `README.md` *(modify)*

---

### Task 1: Swap the data layer to Postgres

This task is deliberately large because the dialect change is **atomic** — the schema, the driver, the routes and the tests all reference each other, and the repository does not typecheck in any intermediate state. Splitting it would produce tasks that cannot be verified.

**Files:**
- Rewrite: `server/db/schema.ts`, `server/db/client.ts`
- Modify: `drizzle.config.ts`, `server/routes/dashboard.ts`, `server/routes/habits.ts`, `server/routes/log.ts`, `scripts/seed.ts`, `scripts/migrate.ts`, `package.json`
- Create: `server/test/pg-harness.ts`, `scripts/reset.ts`
- Modify: `server/routes/habits.spec.ts`, `server/routes/log.spec.ts`
- Delete and regenerate: `drizzle/`

**Interfaces:**
- Consumes: nothing from earlier tasks — this is the first.
- Produces:
  - `habits`, `habitEntries` Postgres tables; `habitKinds`, `habitStatuses`, `HabitKind`, `HabitStatus`, `Habit`, `HabitEntry` (unchanged names and TS shapes)
  - `db` from `server/db/client.ts` — a `NeonDatabase` with the schema attached
  - `createTestDb(): Promise<PgliteDatabase<typeof schema>>` from `server/test/pg-harness.ts`

- [ ] **Step 1: Install and remove dependencies**

```bash
pnpm add @neondatabase/serverless
pnpm add -D @electric-sql/pglite dotenv
pnpm remove better-sqlite3 @types/better-sqlite3
```

`dotenv` is needed because `drizzle-kit`, `tsx` and the dev server all need `DATABASE_URL` from a local `.env`, and none of them load one on their own.

`pnpm-workspace.yaml` still lists `better-sqlite3` under `allowBuilds`. Remove that one line — it now names a package that is not installed. Leave every other entry exactly as it is; which ones are present depends on which branch this lands on, and each is a deliberate decision pnpm requires.

- [ ] **Step 2: Rewrite the schema**

Replace `server/db/schema.ts` entirely:

```ts
import { boolean, doublePrecision, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const habitKinds = ['binary', 'quantity'] as const
export const habitStatuses = ['active', 'upcoming', 'archived'] as const

export type HabitKind = (typeof habitKinds)[number]
export type HabitStatus = (typeof habitStatuses)[number]

export const habits = pgTable('habits', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  // Enum is enforced in TypeScript and by Zod at the edge, not by a Postgres
  // enum type — adding a status later should not need an ALTER TYPE (D-7).
  kind: text('kind', { enum: habitKinds }).notNull().default('binary'),
  /** Label for the logged amount, e.g. "minutes". Null for binary habits. */
  unit: text('unit'),
  /** Daily goal for quantity habits. Drives square shading (D-2). */
  target: doublePrecision('target'),
  notesEnabled: boolean('notes_enabled').notNull().default(false),
  status: text('status', { enum: habitStatuses }).notNull().default('active'),
  /**
   * Day the habit last entered `active` — starts the grace period (D-3).
   * Text, not a Postgres `date`: every day in this codebase is a local
   * calendar day written YYYY-MM-DD, and a driver returning Date objects
   * would silently break all of it (D-8).
   */
  activatedAt: text('activated_at'),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const habitEntries = pgTable(
  'habit_entries',
  {
    id: serial('id').primaryKey(),
    habitId: integer('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    /** Local calendar day, YYYY-MM-DD. One row per habit per day (D-8). */
    date: text('date').notNull(),
    /** Showed up at all. Derived from `value > 0` for quantity habits (D-1). */
    completed: boolean('completed').notNull().default(false),
    /** Minutes, reps, … for quantity habits. Null for binary. */
    value: doublePrecision('value'),
    note: text('note'),
  },
  t => [uniqueIndex('habit_entries_habit_date_idx').on(t.habitId, t.date)],
)

export type Habit = typeof habits.$inferSelect
export type HabitEntry = typeof habitEntries.$inferSelect
```

Note the `sql` import from `drizzle-orm` is gone — `defaultNow()` replaces it. Leaving it would fail `noUnusedLocals`.

- [ ] **Step 3: Rewrite the database client**

Replace `server/db/client.ts`:

```ts
import { Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and paste your Neon connection string.',
  )
}

export const DATABASE_URL = connectionString

/**
 * Pool over WebSocket rather than the HTTP driver: `neon-http` has no
 * transaction support, and PUT /api/log/:date needs a real one so a partial
 * day cannot commit while the client is told the save failed (D-14).
 */
export const pool = new Pool({ connectionString })

export const db = drizzle(pool, { schema })
```

The old `sqlite` export, the WAL and foreign-key pragmas, `DB_PATH` and the `mkdirSync` call are all gone — they were SQLite-specific.

- [ ] **Step 4: Point drizzle-kit at Postgres**

Replace `drizzle.config.ts`:

```ts
import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

- [ ] **Step 5: Load .env where it is needed, and write .env.example**

Add `import 'dotenv/config'` as the **first line** of `server/index.ts`, `scripts/seed.ts` and `scripts/migrate.ts`. On Vercel the environment is injected directly and dotenv simply finds no file, which is harmless.

Do **not** add it to `server/app.ts` or `server/db/client.ts` — those are imported by tests, which must not pick up a developer's `.env`.

Create `.env.example`:

```bash
# Neon connection string for local development.
# Use a `dev` branch of the Neon project, never the production branch.
# Neon console -> your project -> Connection Details -> copy the pooled string.
DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
```

Add `.env` to `.gitignore` (it is not currently listed), and remove the now-meaningless
`data/*.db`, `data/*.db-shm` and `data/*.db-wal` entries.

- [ ] **Step 6: Convert the routes to async**

Every database call loses its `.all()`, `.get()` or `.run()` and gains an `await`. `.get()` has no Postgres equivalent — read the first element of the awaited array instead. Each handler containing one becomes `async`.

`server/routes/dashboard.ts` — the handler becomes `async c => {`:

```ts
  const active = await db
    .select()
    .from(habits)
    .where(eq(habits.status, 'active'))
    .orderBy(asc(habits.id))

  const entries = await db.select().from(habitEntries)
```

`server/routes/habits.ts` — all three handlers become `async`:

```ts
  const rows = await (status ? query.where(eq(habits.status, status as (typeof habitStatuses)[number])) : query)
    .orderBy(asc(habits.id))
```

```ts
  const [created] = await db
    .insert(habits)
    .values({
      ...input,
      activatedAt: input.status === 'active' ? today() : null,
    })
    .returning()
```

```ts
  const [existing] = await db.select().from(habits).where(eq(habits.id, id))
```

```ts
  const [updated] = await db
    .update(habits)
    .set({
      ...input,
      ...(becomingActive ? { activatedAt: today() } : {}),
    })
    .where(eq(habits.id, id))
    .returning()
```

`server/routes/log.ts` — `habitsForDate` and `dayPayload` become `async`, and every caller awaits them:

```ts
async function habitsForDate(date: string): Promise<Habit[]> {
  const active = await db.select().from(habits).where(eq(habits.status, 'active'))

  const logged = await db
    .select({ habitId: habitEntries.habitId })
    .from(habitEntries)
    .where(eq(habitEntries.date, date))

  const loggedIds = logged.map(row => row.habitId)

  const extras = loggedIds.length
    ? await db
        .select()
        .from(habits)
        .where(and(inArray(habits.id, loggedIds), ne(habits.status, 'archived')))
    : []

  const byId = new Map<number, Habit>()
  for (const habit of [...active, ...extras]) byId.set(habit.id, habit)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}
```

```ts
async function dayPayload(date: string) {
  const forDate = await habitsForDate(date)
  const entries = await db.select().from(habitEntries).where(eq(habitEntries.date, date))
  const byHabit = new Map(entries.map(entry => [entry.habitId, entry]))
  // …the mapping below is unchanged…
}
```

**The transaction keeps its shape but every statement inside it is awaited**, and the callback becomes `async`:

```ts
  await db.transaction(async tx => {
    for (const input of entries) {
      const [habit] = await tx.select().from(habits).where(eq(habits.id, input.habitId))
      if (!habit) throw new LogEntryError(`Habit ${input.habitId} not found`, 404)
      if (habit.status === 'archived') {
        throw new LogEntryError(`Habit ${input.habitId} is archived`, 400)
      }

      const isQuantity = habit.kind === 'quantity'
      const value = isQuantity ? (input.value ?? 0) : null
      const completed = isQuantity ? value! > 0 : Boolean(input.completed)

      const [existing] = await tx
        .select()
        .from(habitEntries)
        .where(and(eq(habitEntries.habitId, habit.id), eq(habitEntries.date, date)))

      const note =
        input.note === undefined
          ? (existing?.note ?? null)
          : (input.note?.trim() ? input.note.trim() : null)

      await tx
        .insert(habitEntries)
        .values({ habitId: habit.id, date, completed, value, note })
        .onConflictDoUpdate({
          target: [habitEntries.habitId, habitEntries.date],
          set: { completed, value, note },
        })
    }
  })
```

Keep the existing `LogEntryError` class, its catch block outside the transaction, and the status codes exactly as they are. D-1, D-5 and D-6 must behave identically afterwards.

- [ ] **Step 7: Rewrite the scripts**

`scripts/migrate.ts` — the migrator comes from the neon-serverless package, and the pool must be closed or the process hangs:

```ts
import 'dotenv/config'
import { migrate } from 'drizzle-orm/neon-serverless/migrator'
import { DATABASE_URL, db, pool } from '../server/db/client'

await migrate(db, { migrationsFolder: './drizzle' })
console.log(`Migrations applied to ${new URL(DATABASE_URL).host}`)
await pool.end()
```

Printing only the host keeps the password out of terminal scrollback.

`scripts/seed.ts` — same values, async, closing the pool:

```ts
/**
 * The four habits being tracked. Safe to re-run: it does nothing if any habits
 * already exist, so it never duplicates or overwrites real history.
 */
import 'dotenv/config'
import { db, pool } from '../server/db/client'
import { habits } from '../server/db/schema'
import { today } from '../server/lib/date'

const STARTERS = [
  { name: 'Exercise', kind: 'binary', unit: null, target: null, notesEnabled: true },
  { name: 'Code reading', kind: 'quantity', unit: 'minutes', target: 15, notesEnabled: false },
  { name: 'Meditation', kind: 'quantity', unit: 'minutes', target: 5, notesEnabled: false },
  { name: 'Record one video', kind: 'binary', unit: null, target: null, notesEnabled: false },
] as const

const existing = await db.select().from(habits)

if (existing.length > 0) {
  console.log(`Skipped: ${existing.length} habit(s) already exist.`)
} else {
  const activatedAt = today()
  await db
    .insert(habits)
    .values(STARTERS.map(habit => ({ ...habit, status: 'active' as const, activatedAt })))
  console.log(`Seeded ${STARTERS.length} habits.`)
}

await pool.end()
```

Create `scripts/reset.ts` — there is no file to delete any more, so reset means dropping the schema:

```ts
/**
 * Drops every table and starts over. `pnpm db:reset` chains this with migrate
 * and seed. Destructive by design — it is how a local database is returned to
 * a known state.
 */
import 'dotenv/config'
import { DATABASE_URL, pool } from '../server/db/client'

await pool.query('DROP SCHEMA public CASCADE')
await pool.query('CREATE SCHEMA public')
console.log(`Schema reset on ${new URL(DATABASE_URL).host}`)
await pool.end()
```

In `package.json` replace the `db:reset` script:

```json
"db:reset": "tsx scripts/reset.ts && pnpm db:migrate && pnpm db:seed"
```

- [ ] **Step 8: Build the pglite test harness**

Create `server/test/pg-harness.ts`:

```ts
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '../db/schema'

/**
 * A real Postgres, compiled to WASM and running in this process. Route tests
 * used to point better-sqlite3 at a temp file; Postgres has no equivalent, and
 * reaching for Neon would make the suite need a network connection.
 */
export async function createTestDb() {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: './drizzle' })
  return db
}
```

- [ ] **Step 9: Point the route tests at the harness**

In **both** `server/routes/habits.spec.ts` and `server/routes/log.spec.ts`, replace the temp-file
setup. The old block to remove looks like this:

```ts
  dir = mkdtempSync(join(tmpdir(), 'habit-routes-'))
  process.env.DATABASE_PATH = join(dir, 'test.db')

  const { db } = await import('../db/client')
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  migrate(db, { migrationsFolder: './drizzle' })

  app = (await import('../app')).createApp()
```

Replace it with a mock of the client module. `vi.mock` is hoisted above imports, so the database
has to live in a holder created by `vi.hoisted` — referencing an ordinary module-level variable
inside the factory throws a ReferenceError:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../test/pg-harness'

const holder = vi.hoisted(() => ({ db: undefined as unknown }))

// A getter, not a value: the database does not exist until beforeAll runs, and
// the routes read this binding on every call rather than capturing it once.
vi.mock('../db/client', () => ({
  get db() {
    return holder.db
  },
}))

let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }

beforeAll(async () => {
  holder.db = await createTestDb()
  app = (await import('../app')).createApp()
})
```

Delete the `afterAll` that removed the temp directory, and the `node:fs`, `node:os` and
`node:path` imports with it — pglite is in-memory and there is nothing to clean up. Leaving
those imports fails `noUnusedLocals`.

Everything below the setup — every `it()`, the `post`/`patch`/`put` helpers, `readJson` — stays
exactly as written. In `log.spec.ts` the `todayKey` line keeps its dynamic import of
`../lib/date`.

**If the mock proves not to take effect** (routes still holding the real client), stop and
report it rather than working around it. The spec's named fallback is a `createApp(db)` factory
taking the database as an argument — cleaner in principle, but it touches every route file,
which is why it is not the first choice.

- [ ] **Step 10: Regenerate the migrations**

```bash
rm -rf drizzle
pnpm db:generate
```

Expected: a single new `drizzle/0000_*.sql` containing Postgres DDL — `CREATE TABLE "habits"`,
`serial`, `boolean`, `double precision`, and a unique index on `habit_entries`.

Confirm it has **no** trace of SQLite: no `integer` primary keys with `AUTOINCREMENT`, no
`--> statement-breakpoint` around an `ALTER TABLE ... DROP COLUMN archived_at`. This is a fresh
initial migration, not a translation of the old ones.

`pnpm db:generate` needs `DATABASE_URL` to be set. If a Neon database is not available yet, set
it to any syntactically valid Postgres URL — generation reads the schema file, not the database.

- [ ] **Step 11: Run the suite**

Run: `npx vitest run`
Expected: **110 passed**, with no network access required. The 77 pure-logic tests were never
touched; the 33 route tests now run against pglite.

If a route test fails on a value rather than a connection, suspect the async conversion — a
missing `await` returns a query builder where a row is expected, which often surfaces as
`undefined` rather than an error.

- [ ] **Step 12: Typecheck, build and commit**

```bash
pnpm typecheck && pnpm build
```

```bash
git add -A
git commit -m "feat(db): move the data layer from SQLite to Neon Postgres

Schema becomes pgTable with real booleans and double precision; the two
day columns stay text so the local-calendar-day contract and every test
that depends on it are untouched (D-8).

The driver is neon-serverless over a WebSocket pool, not neon-http, whose
transaction() throws outright — PUT /api/log/:date depends on a real one
so a partial day cannot commit while the client is told the save failed
(D-14).

Postgres Drizzle is async, so all 13 .all()/.get()/.run() calls across the
three route files are now awaited and their handlers are async. Behaviour
is unchanged: D-1, D-5 and D-6 all still hold.

Route tests lose the temporary-SQLite-file trick and move to pglite, real
Postgres in WASM, so the suite still runs offline."
```

---

### Task 2: Verify against a real Neon database

Everything so far is verifiable offline. This task is the first that needs an actual database, and it needs **you** — a Neon project cannot be created from here.

**Files:**
- Create (untracked): `.env`

**Interfaces:**
- Consumes: everything from Task 1
- Produces: nothing consumed by later tasks; this is a verification gate

- [ ] **Step 1: Ask for a Neon connection string**

Stop and ask the human partner for one. They need to:

1. Create a free project at `neon.tech`.
2. Create a **`dev` branch** of it — the production branch is for Phase 3, and local development must never point at production data.
3. Copy the **pooled** connection string for that branch.

Then locally: `cp .env.example .env` and paste it as `DATABASE_URL`.

Do not proceed without this. Do not invent a connection string, and do not fall back to a local
Postgres — the whole point of the phase is that the dialect matches production exactly.

- [ ] **Step 2: Create the schema and seed it**

```bash
pnpm db:migrate
pnpm db:seed
```

Expected: migrations applied to the Neon host, then `Seeded 4 habits.`

- [ ] **Step 3: Confirm what landed**

```bash
pnpm db:studio
```

Or query directly — the four habits must have the right kinds, units, targets and statuses:
Exercise (binary, notes on), Code reading (quantity/minutes/15), Meditation (quantity/minutes/5),
Record one video (binary), all `active` with today's `activated_at`.

- [ ] **Step 4: Exercise all three screens**

```bash
pnpm dev
```

At `http://localhost:5173`, confirm:

1. **Dashboard** renders four habits with empty grids and no console errors.
2. **`/log`** saves a day — tick Exercise with a note, set Meditation to 5, Save. Reload: the values come back.
3. **Dashboard** now shades today's squares; Meditation at its target is level 3.
4. **`/habits`** renames a habit inline and changes Meditation's target; the dashboard re-shades.
5. **Atomicity still holds** — this is the behaviour most at risk from the driver change:

```bash
curl -s -X PATCH localhost:5174/api/habits/4 -H 'content-type: application/json' -d '{"status":"archived"}'
curl -s -X PUT localhost:5174/api/log/$(date +%F) -H 'content-type: application/json' \
  -d '{"entries":[{"habitId":1,"completed":true},{"habitId":4,"completed":true}]}'
```

Expected: `400` naming habit 4 as archived — **and** habit 1's entry for today must be absent
afterwards. If habit 1 was written, the transaction is not rolling back and the driver choice
needs revisiting before anything else proceeds.

Restore habit 4 with `'{"status":"active"}'` when done.

- [ ] **Step 5: Confirm data survives a restart**

Stop `pnpm dev`, start it again, reload the dashboard. Today's entries are still there — they
now live in Neon, not in a file on disk.

- [ ] **Step 6: Report**

No commit — this task produces no tracked files. Report what was verified, and in particular
whether the transaction rollback in Step 4.5 behaved correctly.

---

### Task 3: Remove the SQLite leftovers and document the setup

**Files:**
- Delete: `data/` (including `.gitkeep`)
- Modify: `README.md`, `.gitignore`

**Interfaces:**
- Consumes: the working Postgres setup from Tasks 1–2
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Delete the vestigial data directory**

```bash
git rm -r --cached data 2>/dev/null || true
rm -rf data
```

Nothing writes there any more. Confirm `.gitignore` no longer mentions `data/*.db` (Task 1,
Step 5 removed those lines) and that it does list `.env`.

- [ ] **Step 2: Update the README**

Replace the SQLite claims with what is now true. In the stack table, the Database row becomes:

```markdown
| Database | Neon Postgres via Drizzle ORM (`neon-serverless`) |
```

Replace the Getting Started block:

```markdown
## Getting started

Copy `.env.example` to `.env` and paste a Neon connection string — use a **dev** branch of the
Neon project, never the production one.

```bash
pnpm install
cp .env.example .env   # then paste your DATABASE_URL
pnpm db:migrate        # create the schema
pnpm db:seed           # add the four habits
pnpm dev
```
```

Replace the Database notes section entirely:

```markdown
## Database notes

Habit data lives in Neon Postgres. Local development and production use **different branches of
the same Neon project**, so the dialect can never drift between them.

Changing `server/db/schema.ts` means `pnpm db:generate` (writes a new file into `drizzle/`,
which *is* committed) followed by `pnpm db:migrate`.

`pnpm db:reset` drops the schema and rebuilds it from migrations plus seed data. It is
destructive and it does not ask — point it at a dev branch, never production.

Days are local calendar days stored as `text` in `YYYY-MM-DD`, never a Postgres `date` — a
driver returning `Date` objects would break every piece of date logic. See `server/lib/date.ts`.

The route tests run against `pglite`, a real Postgres compiled to WASM, so `pnpm test` needs no
database and no network.
```

Update the commands table: `pnpm db:reset` is now "Drop the schema, migrate, and reseed the four
habits". Everything else is unchanged.

- [ ] **Step 3: Verify the README against reality**

Read the finished README start to finish and check every claim against the code: the commands
exist in `package.json`, the ports are right, the file paths in the layout section still exist
(`data/habits.db` must be gone), and nothing still says SQLite.

- [ ] **Step 4: Final gate and commit**

```bash
pnpm typecheck && pnpm test && pnpm build
```

```bash
git add -A
git commit -m "chore: remove SQLite leftovers and document the Neon setup

Deletes the vestigial data/ directory, drops the .db gitignore entries,
and rewrites the README's database section: connection via .env, a Neon
branch per environment, the new destructive db:reset, and why the day
columns are text rather than a Postgres date."
```

---

## Done when

- `pnpm typecheck`, `pnpm test` (110 passing) and `pnpm build` all pass, with the suite needing no network.
- The app runs locally against a Neon dev branch and all three screens work.
- A day logged through the UI survives a restart.
- `PUT /api/log/:date` still rolls back cleanly when one entry in the batch is invalid.
- No file in the repository references `better-sqlite3`, `DATABASE_PATH`, or `data/habits.db`.
