# Hosted habit tracker — Neon Postgres, Google sign-in, Vercel

> Status: approved, not yet implemented
> Date: 2026-09-13

Moves the tracker off the laptop: habit data into Neon Postgres, the app onto Vercel, and
everything behind a Google sign-in restricted to one email.

## Why

The tracker currently runs only where the code is checked out, behind `pnpm dev`, against a
SQLite file that exists in exactly one place with no second copy. Two consequences:

- **It does not survive a dead disk.** `data/habits.db` is gitignored and unbacked.
- **It is only usable at a desk.** A habit logged at 11pm on the sofa is a habit not logged,
  and a tracker you do not open is worthless regardless of how well it works.

Hosting solves both: the data gains a provider's durability, and the app becomes a URL.

## Constraints that shape everything

**`better-sqlite3` cannot run on Vercel.** It is a native module and serverless functions have
no persistent filesystem. The database layer changes no matter what else we decide.

**Anything public must be guarded from the first deploy.** Free-text notes about the user's
life cannot sit on an open URL, even briefly.

## Phasing, and why this order

Three phases, each leaving a working app:

1. **Neon Postgres** — still running locally, fully verifiable before anything is exposed.
2. **Auth** — built and tested locally against the real Neon database.
3. **Vercel** — the first time anything is public, it is already guarded.

The tempting order is Postgres → deploy → auth. **That is unsafe**: it puts habit data on a
public URL for however long auth takes. Auth precedes exposure, always.

**Each phase gets its own implementation plan.** One plan covering all three would be too large
to execute or review as a unit, and phases 2 and 3 depend on decisions that only become
concrete once the phase before them has landed.

---

# Phase 1 — Neon Postgres

## Schema translation

`server/db/schema.ts` moves from `sqliteTable` to `pgTable`. Column by column:

| Column | SQLite now | Postgres | Note |
|---|---|---|---|
| `habits.id` | `integer` pk autoincrement | `serial` pk | |
| `habits.name` | `text` | `text` | |
| `habits.kind` | `text({enum})` | `text({enum})` | see D-7 |
| `habits.unit` | `text` | `text` | |
| `habits.target` | `real` | `doublePrecision` | |
| `habits.notesEnabled` | `integer({mode:'boolean'})` | `boolean` | a real boolean at last |
| `habits.status` | `text({enum})` | `text({enum})` | see D-7 |
| `habits.activatedAt` | `text` | `text` | see D-8 |
| `habits.createdAt` | `text` default current_timestamp | `timestamp({mode:'string', withTimezone:true})` defaultNow | string mode keeps the wire shape |
| `habitEntries.id` | `integer` pk autoincrement | `serial` pk | |
| `habitEntries.habitId` | `integer` fk cascade | `integer` fk cascade | unchanged |
| `habitEntries.date` | `text` | `text` | see D-8 |
| `habitEntries.completed` | `integer({mode:'boolean'})` | `boolean` | |
| `habitEntries.value` | `real` | `doublePrecision` | |
| `habitEntries.note` | `text` | `text` | |

The unique index on `(habitId, date)` carries over unchanged, as does the cascade delete.

## Every query becomes asynchronous

Not a schema concern but the largest mechanical change in the phase: the routes make **13 calls**
to `.all()`, `.get()` and `.run()` across `dashboard.ts`, `habits.ts` and `log.ts`. Those are
better-sqlite3's synchronous API. Postgres Drizzle is asynchronous — the query builder is
awaited directly, `.get()` becomes reading the first row of an awaited result, and every route
handler that touches the database becomes `async`. The pure-logic modules are untouched.

**D-7 — enums stay TypeScript-level `text({ enum })`, not `pgEnum`.** A real Postgres enum type
gives database-level integrity, but changing one later needs `ALTER TYPE`, and this app's
statuses are likely to grow. Zod already validates every write at the edge. The cost of being
wrong is a missing database constraint on a single-user app; the cost of the alternative is
migration friction every time a status is added.

**D-8 — the two day columns stay `text`, not Postgres `date`.** Every date in this codebase is
a local calendar day written `YYYY-MM-DD`, and all the pure logic and its tests assume strings.
Postgres `date` would work, but it invites a driver returning `Date` objects and silently
breaking that contract. `text` guarantees no conversion happens. This preserves D-1 through D-6
from the original design untouched.

## Driver and connection

**D-14 — the driver is `drizzle-orm/neon-serverless` (Pool over WebSocket), not
`neon-http`.** This corrects an earlier draft of this spec. `neon-http` sends each statement as
its own HTTP request and its `transaction()` throws outright:

    No transactions support in neon-http driver

`PUT /api/log/:date` depends on a real transaction — it was made atomic precisely so a partial
day cannot commit while the client is told the save failed. On `neon-http` that route would
throw on every save. The WebSocket pool costs a little more connection setup per cold start;
correctness wins.

- `@neondatabase/serverless` (`Pool`) + `drizzle-orm/neon-serverless`.
- `server/db/client.ts` reads `DATABASE_URL` instead of `DATABASE_PATH`.
- `better-sqlite3`, `@types/better-sqlite3` and the `DATABASE_PATH` handling are removed, along
  with the WAL and foreign-key pragmas, which are SQLite-specific.
- `drizzle.config.ts` dialect becomes `postgresql`.

**The existing `drizzle/` migrations are deleted and regenerated.** They are SQLite DDL and
cannot apply to Postgres. There is no production data to preserve — the only database in
existence is a local scratch one with four seeded habits and no entries.

## Local development

Neon supports database branching. Local development uses a `dev` branch of the same Neon
project that production uses; both are Postgres, so the dialect can never drift between them.
`apps`-style env separation is unnecessary — one `DATABASE_URL` per environment.

`docker-compose.yml` is not introduced; there is no local Postgres to run.

## Tests — the part that does not come for free

33 of the 110 tests are route tests that create a temporary SQLite **file**, run
migrations against it, and exercise the real API. Postgres has no equivalent trick, and
requiring a network connection to Neon just to run `pnpm test` would be a serious regression.

**`@electric-sql/pglite`** — real Postgres compiled to WASM, running in-process — replaces it.
Drizzle ships `drizzle-orm/pglite` and `drizzle-orm/pglite/migrator`, so the shape of the test
setup barely changes: create an in-memory instance, migrate from `./drizzle`, use it.

**D-9 — route tests inject the database with `vi.mock`, not an environment variable.** The
current tests set `DATABASE_PATH` before a dynamic import, which works only because SQLite
takes a file path. A pglite instance is an object, not a string, so it cannot travel through
`process.env`. Mocking `server/db/client` to return a pglite-backed Drizzle instance keeps
production code free of test-only branching — the alternative, a `NODE_ENV === 'test'` fork
inside `client.ts`, puts test concerns in shipping code.

The pure-logic tests (date, level, consistency, dashboard) touch no database and are unaffected.

## Phase 1 is done when

`pnpm typecheck`, `pnpm test` and `pnpm build` pass; the app runs locally against Neon; all
three screens work; and the four habits plus a logged day survive a restart.

---

# Phase 2 — Google sign-in, one email

## Flow

1. `/login` renders a Google Identity Services button configured with `GOOGLE_CLIENT_ID`.
2. Google returns a signed **ID token** (a JWT) to the page.
3. The page POSTs it to `/api/auth/session`.
4. The server verifies the token against Google's public keys (JWKS), checking signature,
   `aud` equals our client id, `iss` is Google, `exp` is in the future, and `email_verified`.
5. The email is checked against the allowlist. Not on it → `403`, no session.
6. On success the server issues its own session JWT and sets it as an httpOnly cookie.
7. Hono middleware guards every `/api` route except the auth endpoints.

**D-10 — the allowlist lives in an environment variable, not the database.** In the database it
is a chicken-and-egg: you would need to be signed in to manage the row that lets you sign in,
and a bad migration or an accidental delete locks you out of your own app permanently. As
config it is one Vercel setting, it fails closed, and it cannot be corrupted by application
code. `ALLOWED_EMAILS` holds a comma-separated list so a second address can be added without a
code change.

**D-11 — the session is a signed stateless JWT in an httpOnly cookie, not a database session.**
Serverless functions have no shared memory and a session table would mean a database round trip
on every request to a single-user app. Stateless means no server-side revocation, which is
acceptable here: the only user can clear the cookie, and the token is short-lived enough
(30 days) to bound the damage of a stolen laptop.

**D-12 — `jose` does both the Google verification and the session signing.** The official
`google-auth-library` would also verify the ID token, but `jose` is needed anyway for the
session, works in both Node and edge runtimes, and one dependency is better than two.

## Endpoints

```
POST   /api/auth/session   { credential }  -> sets cookie, returns { email }
GET    /api/auth/me                        -> { email } or 401
POST   /api/auth/logout                    -> clears the cookie
```

Everything under `/api` requires a valid session cookie and returns `401` without one, with
two deliberate exceptions: `/api/auth/*`, which is how a session is obtained, and `/api/health`,
which returns only `{ ok: true }` and reveals nothing about the user or their data.

## Cookie and CSRF

`httpOnly`, `Secure`, `SameSite=Lax`, 30-day expiry, signed with `SESSION_SECRET`.

`SameSite=Lax` plus a same-origin API is sufficient here: the mutating routes are POST/PUT/PATCH
carrying `content-type: application/json`, which a browser will not send cross-origin without a
CORS preflight the server does not grant. No CSRF token is introduced.

## Client

- `src/pages/login.vue` — the Google button and nothing else.
- A composable resolving the session once from `/api/auth/me`.
- A router guard redirecting unauthenticated visitors to `/login`, and away from `/login` when
  already signed in.
- `src/lib/api.ts` gains one behaviour: a `401` clears local session state and redirects to
  `/login`, so an expired cookie does not present as a generic error. This extends the existing
  unreachable-API handling rather than replacing it.

**The guard is a convenience, not the security boundary.** The server rejecting unauthenticated
requests is what actually protects the data; a client-side guard only stops the UI flashing.
Both exist, and the spec is explicit that only one of them matters.

## Phase 2 is done when

Signing in with the allowed Google account works; signing in with any other account is refused;
a request to any `/api` route without a cookie returns 401; and the session survives a reload.

---

# Phase 3 — Vercel

## Shape

- **Frontend**: the existing Vite build, served as static assets. SPA routing needs a rewrite so
  deep links like `/log?date=…` reach `index.html` rather than 404.
- **API**: one serverless function at `api/index.ts` exporting the existing Hono app through
  `handle` from **`hono/vercel`** — a built-in Hono subpath, not a separate package. The routes
  themselves need no changes.
- `vercel.json` carries the rewrites.

## Environment variables

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection string (separate branch per environment) |
| `GOOGLE_CLIENT_ID` | the OAuth client, server side |
| `VITE_GOOGLE_CLIENT_ID` | the same value, for the browser — Vite only exposes `VITE_`-prefixed variables, so this duplication is required, not an oversight |
| `ALLOWED_EMAILS` | comma-separated allowlist |
| `SESSION_SECRET` | signs the session JWT |

The client id is public by nature and may be exposed to the browser. The other three are
server-only and must never reach the bundle.

**D-13 — migrations are run deliberately, never as part of a deploy.** A build step that
migrates means a bad schema change ships itself the moment it is pushed, and Vercel builds run
on every commit. A `pnpm db:migrate:prod` invoked by a human, against an explicit
`DATABASE_URL`, keeps schema changes a decision rather than a side effect.

## Phase 3 is done when

The deployed URL serves the app, sign-in works end to end against the production Neon branch,
an unauthenticated visitor can reach nothing but `/login`, and a habit logged on a phone appears
on the desktop.

---

# Out of scope

Multi-user support; any notion of accounts beyond the allowlist; offline or PWA behaviour;
push notifications and reminders; migrating existing local data (there is none worth moving);
the export/backup script (a hosted database makes it non-urgent, though free tiers keep only
limited history and it remains worth adding later); and the rename feature currently sitting
unmerged on its own branch, which is unaffected by any of this.

# Risks

**Free-tier limits.** Neon's free tier suspends a database after inactivity; the first request
after a pause pays a cold start of a second or two. Acceptable for a personal tracker, and
worth knowing before it looks like a bug.

**`vi.mock` and module resolution.** D-9 depends on the route tests successfully substituting
the db module. If that proves awkward, the fallback is a `createApp(db)` factory taking the
database as an argument — cleaner in principle, but it touches every route file, which is why
it is not the first choice.

**Google Identity Services requires a real origin.** The button will not render on arbitrary
hosts; `localhost` must be registered as an authorised JavaScript origin on the OAuth client
alongside the eventual Vercel domain, or Phase 2 cannot be tested locally at all.
