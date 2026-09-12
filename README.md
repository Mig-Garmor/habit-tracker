# Habit Tracker

A single-user habit tracker. Data lives in a SQLite file on disk; nothing leaves the machine.

## Stack

| Piece | Choice |
|---|---|
| UI | Vue 3 + TypeScript, Vite |
| Routing | vue-router v5 file-based routing (`src/pages/`) |
| Components | shadcn-vue (reka-ui) |
| Styling | Tailwind v3, written inside SCSS files |
| API | Hono on Node |
| Database | SQLite via Drizzle ORM + better-sqlite3 |
| Tests | Vitest |

## Getting started

```bash
pnpm install
pnpm db:migrate   # create the schema
pnpm db:seed      # add four starter habits
pnpm dev
```

`pnpm dev` runs both halves: the Vite dev server on **5173** and the Hono API on **5174**.
Vite proxies `/api/*` to the API, so the browser only ever talks to 5173.

Open http://localhost:5173.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Vite + API together |
| `pnpm dev:web` / `pnpm dev:api` | One half on its own |
| `pnpm build` | Typecheck, then build to `dist/` |
| `pnpm typecheck` | `vue-tsc` across app, server and scripts |
| `pnpm test` | Vitest, once |
| `pnpm test:watch` | Vitest, watching |
| `pnpm db:generate` | Turn schema changes into a migration in `drizzle/` |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Insert starter habits (no-op if any exist) |
| `pnpm db:reset` | Drop the database, migrate, and reseed the four habits |
| `pnpm db:studio` | Browse the database in Drizzle Studio |

## Layout

```
data/habits.db        your data — gitignored
drizzle/              generated migration SQL — committed
server/
  index.ts            listener — binds the port
  app.ts              Hono app + route wiring (used directly by tests, no port needed)
  routes/             /api/habits, /api/dashboard, /api/log
  db/schema.ts        Drizzle tables
  db/client.ts        better-sqlite3 connection
  lib/                pure date/level/consistency/dashboard logic (+ .spec.ts each)
scripts/              migrate.ts, seed.ts
src/
  pages/              file-system routes
  components/         your components
  components/ui/      shadcn-vue — vendored, don't hand-edit
  styles/main.scss    Tailwind directives + design tokens
  lib/api.ts          typed fetch wrappers
```

## Routing

File-based: add `src/pages/stats.vue` and `/stats` exists; `src/pages/habits/[id].vue` would give
`/habits/:id` with a typed `id` param. Types are regenerated into `typed-router.d.ts` (gitignored)
as you save. The three routes actually wired up today are listed below.

## Screens

| Route | What it does |
|---|---|
| `/` | Dashboard — an activity grid per active habit, with slipping habits called out |
| `/log` | Record a day. `?date=YYYY-MM-DD` backfills; tapping any square lands here |
| `/habits` | Manage the active list, the upcoming backlog, and the archive |

## Styling convention

**Tailwind lives in SCSS, not in templates.** Every component has a sibling `.scss` file, so
the `.vue` file stays template + script:

```vue
<template>
  <div class="log-card">…</div>
</template>

<style lang="scss" scoped src="./LogHabitCard.scss"></style>
```

```scss
.log-card {
  @apply flex flex-col gap-3 rounded-lg border p-4;

  &__head {
    @apply flex items-center gap-3;
  }

  &__name {
    @apply cursor-pointer text-sm font-medium;
  }
}
```

Use the design tokens (`bg-background`, `text-muted-foreground`, `border-border`, …) rather than
raw palette colours — they're defined once in `src/styles/main.scss` and drive light and dark mode.

**One exception:** `src/components/ui/*` arrives from the shadcn CLI with Tailwind classes inline.
That's vendored library code — leave it alone and restyle through the tokens instead.

Add more components with:

```bash
npx shadcn-vue@1.0.3 add dialog input select
```

The `@1.0.3` pin matters — shadcn-vue 2.x targets Tailwind v4, and this project is on v3.

## Database notes

`data/habits.db` is **gitignored** — your real habit data stays local. A fresh clone gets a
working database from `pnpm db:migrate && pnpm db:seed`.

Changing `server/db/schema.ts` means `pnpm db:generate` (writes a new file into `drizzle/`,
which *is* committed) followed by `pnpm db:migrate`.

Days are local calendar days keyed `YYYY-MM-DD`, never UTC — see `server/lib/date.ts`. Ticking a
habit at 11pm must land on that day, not tomorrow.
