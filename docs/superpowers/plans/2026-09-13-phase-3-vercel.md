# Phase 3 — Vercel Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the habit tracker on a public URL — frontend as static assets, the Hono API as a serverless function, data in Neon — with the session cookie correctly secured.

**Architecture:** Vite's existing build output is served statically. The existing Hono app is exported through `hono/vercel`'s `handle` from a single catch-all function at `api/index.ts`, so no route changes. A `vercel.json` rewrites `/api/*` to that function and everything else to `index.html` for the SPA router. Migrations stay a deliberate human command, never a build step.

**Tech Stack:** Vercel, `hono/vercel` (built into Hono, not a separate package), Vite, Neon Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-13-hosted-migration-design.md` — read it alongside this plan. **D-13** and **D-15** govern this phase; D-1 through D-12 and D-14 describe behaviour it must not disturb.

## The gate before any of this runs

**Sign-in has never been exercised end to end.** There is no Google OAuth client id configured, so `POST /api/auth/session` has never verified a real token. The spec is explicit:

> The tempting order is Postgres → deploy → auth. **That is unsafe**: it puts habit data on a public URL for however long auth takes. Auth precedes exposure, always.

Deploying an unverified sign-in is the same mistake in a different order. **Task 3 must not begin until sign-in has been confirmed working locally** against a real Google client id. Tasks 1 and 2 are safe to do beforehand — they change code and configuration but expose nothing.

## Global Constraints

- **Nothing may log, echo or commit a secret.** `SESSION_SECRET`, `DATABASE_URL`, the Google credential and the session cookie value never appear in a log line, an error message, a report or a commit.
- **Migrations are never a build step** (D-13). Vercel builds on every push; a migrating build ships a bad schema change the moment it is committed.
- **The server is the security boundary.** The browser's router guard protects nothing.
- `noUnusedLocals` and `noUnusedParameters` are on for `server/**` — an unused import is a build failure.
- `pnpm typecheck`, `npx vitest run` (147 currently) and `pnpm build` must all pass before every commit, and the suite must stay network-free.
- **`main` is protected**: every change needs a branch, a PR, and a green `verify` check. Branches must be up to date with `main` before merging.

## File Structure

**The D-15 fix — pure, testable offline:**
- `server/auth/request.ts` *(create)* — decide whether a request arrived over HTTPS
- `server/auth/request.spec.ts` *(create)*
- `server/auth/cookie.ts` *(modify)* — conditional name and `secure` from the above
- `server/middleware/require-session.ts`, `server/routes/auth.ts` *(modify)* — read either cookie name

**Deployment surface:**
- `api/index.ts` *(create)* — the one serverless function
- `vercel.json` *(create)* — rewrites
- `.vercelignore` *(create)*
- `package.json` *(modify)* — a `db:migrate:prod` script

**Docs:**
- `README.md` *(modify)*, `docs/superpowers/specs/2026-09-13-hosted-migration-design.md` *(modify — record D-16)*

---

### Task 1: Resolve D-15 — secure the session cookie

The security fix, done first and entirely offline. Phase 2 derives `secure` from `new URL(c.req.url).protocol`, which is right locally and wrong behind a TLS-terminating proxy: Vercel decrypts at its edge and the function can see a plain `http:` request, so the production cookie would silently lose `Secure` — in the one deployment where it matters most.

**Files:**
- Create: `server/auth/request.ts`, `server/auth/request.spec.ts`
- Modify: `server/auth/cookie.ts`, `server/middleware/require-session.ts`, `server/routes/auth.ts`
- Modify: `server/routes/auth.spec.ts` (the logout assertion checks the cookie name)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `isSecureRequest(forwardedProto: string | undefined, requestUrl: string): boolean`
  - `SESSION_COOKIE_SECURE = '__Host-habit_session'`, `SESSION_COOKIE_PLAIN = 'habit_session'`
  - `sessionCookieName(secure: boolean): string`
  - `readSessionCookie(c: Context): string | undefined` — checks both names
  - `sessionCookieOptions(secure: boolean): CookieOptions` — **signature changes**: it now takes a boolean rather than a URL string

- [ ] **Step 1: Write the failing test**

Create `server/auth/request.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isSecureRequest } from './request'

describe('isSecureRequest', () => {
  // Behind Vercel the function sees plain http; x-forwarded-proto is the truth.
  it('trusts x-forwarded-proto over the request URL', () => {
    expect(isSecureRequest('https', 'http://internal.local/api/habits')).toBe(true)
  })

  it('reports insecure when the proxy says http', () => {
    expect(isSecureRequest('http', 'http://internal.local/api/habits')).toBe(false)
  })

  // Proxy chains append, so the client-facing protocol is the FIRST entry.
  it('takes the first entry of a comma-separated chain', () => {
    expect(isSecureRequest('https,http', 'http://internal.local/x')).toBe(true)
    expect(isSecureRequest('http,https', 'http://internal.local/x')).toBe(false)
  })

  it('tolerates whitespace in the chain', () => {
    expect(isSecureRequest(' https , http ', 'http://internal.local/x')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isSecureRequest('HTTPS', 'http://internal.local/x')).toBe(true)
  })

  // No proxy header: local development, where the URL is the truth.
  it('falls back to the request URL when the header is absent', () => {
    expect(isSecureRequest(undefined, 'https://example.com/x')).toBe(true)
    expect(isSecureRequest(undefined, 'http://localhost:5173/x')).toBe(false)
  })

  it('falls back when the header is empty', () => {
    expect(isSecureRequest('', 'https://example.com/x')).toBe(true)
    expect(isSecureRequest('   ', 'http://localhost:5173/x')).toBe(false)
  })

  // A malformed URL must not throw and must not claim to be secure.
  it('reports insecure rather than throwing on a malformed URL', () => {
    expect(isSecureRequest(undefined, 'not a url')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run server/auth/request.spec.ts`
Expected: FAIL — cannot find module `./request`.

- [ ] **Step 3: Implement**

Create `server/auth/request.ts`:

```ts
/**
 * Did this request reach the user over HTTPS?
 *
 * Vercel terminates TLS at its edge, so the function behind it sees a plain
 * `http:` request even when the browser used HTTPS. Deriving security from the
 * request URL alone would silently drop `Secure` from the session cookie in
 * production — the one place it matters most (D-15).
 */
export function isSecureRequest(
  forwardedProto: string | undefined,
  requestUrl: string,
): boolean {
  const forwarded = forwardedProto?.trim()
  if (forwarded) {
    // Proxy chains append to this header; the client-facing hop is first.
    const [clientFacing] = forwarded.split(',')
    return clientFacing!.trim().toLowerCase() === 'https'
  }

  try {
    return new URL(requestUrl).protocol === 'https:'
  } catch {
    // A URL we cannot parse is not one we will call secure.
    return false
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run server/auth/request.spec.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Rewrite the cookie module**

This is the subtle part. The `__Host-` prefix closes a real gap — on a shared apex like `*.vercel.app`, a sibling deployment can set a cookie of the same name on the parent domain — but **browsers reject a `__Host-` cookie that lacks `Secure`**. Naming it that unconditionally would break local development over plain http, where the cookie would simply never be stored and sign-in would appear to do nothing.

So the name follows the security of the request, and the reader accepts either.

Replace `server/auth/cookie.ts`:

```ts
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type { CookieOptions } from 'hono/utils/cookie'
import { isSecureRequest } from './request'
import { SESSION_MAX_AGE_SECONDS } from './session'

/**
 * The `__Host-` prefix requires Secure, Path=/ and no Domain, and in exchange
 * stops a sibling deployment on the same apex (*.vercel.app) from planting a
 * cookie of this name. Browsers REJECT a `__Host-` cookie without Secure, so
 * local http development has to use the plain name or sign-in silently fails.
 */
export const SESSION_COOKIE_SECURE = '__Host-habit_session'
export const SESSION_COOKIE_PLAIN = 'habit_session'

export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_PLAIN
}

/** Whether this request reached the user over HTTPS (D-15). */
export function requestIsSecure(c: Context): boolean {
  return isSecureRequest(c.req.header('x-forwarded-proto'), c.req.url)
}

/**
 * SameSite=Lax plus a same-origin API is the CSRF defence: every mutating
 * route requires `content-type: application/json`, which a browser will not
 * send cross-origin without a preflight the server never grants.
 */
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  }
}

/**
 * Reads whichever name this deployment uses. Checking both means a session
 * issued before a protocol change is still honoured rather than silently
 * logging the user out.
 */
export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_SECURE) ?? getCookie(c, SESSION_COOKIE_PLAIN)
}
```

- [ ] **Step 6: Update the three call sites**

In `server/middleware/require-session.ts`, replace the `getCookie` import and the read:

```ts
import { readSessionCookie } from '../auth/cookie'
```

```ts
    const email = await readSessionToken(readSessionCookie(c) ?? '', secret)
```

That file currently imports **both** `getCookie` from `hono/cookie` and `SESSION_COOKIE` from `../auth/cookie`. Both become unused and both must go, or `noUnusedLocals` fails the build.

In `server/routes/auth.ts`, the session endpoint computes security once and uses it for both the name and the options:

```ts
  const secure = requestIsSecure(c)
  setCookie(
    c,
    sessionCookieName(secure),
    await createSessionToken(email, secret),
    sessionCookieOptions(secure),
  )
```

`GET /api/auth/me` reads via `readSessionCookie(c)`. And logout must clear **both** names, since a deployment's protocol can change:

```ts
authRoutes.post('/logout', c => {
  if (!hasJsonContentType(c)) {
    return c.json({ error: 'Expected content-type: application/json' }, 400)
  }
  deleteCookie(c, SESSION_COOKIE_SECURE, { path: '/' })
  deleteCookie(c, SESSION_COOKIE_PLAIN, { path: '/' })
  return c.json({ ok: true })
})
```

Adjust the imports in `auth.ts` to match what it now uses, and delete what it no longer does.

- [ ] **Step 7: Update the affected existing tests**

`server/routes/auth.spec.ts` asserts on the logout cookie name and sends a cookie header. The test requests have no `x-forwarded-proto` and use an `http://` URL, so they exercise the **plain** name — which is correct and needs no change to the header they send.

The logout assertion must now tolerate both cookies being cleared:

```ts
  it('clears the cookie', async () => {
    const response = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    expect(response.status).toBe(200)
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('habit_session=')
    expect(setCookie).toMatch(/Max-Age=0|Expires=/i)
  })
```

Add one test proving the prefixed cookie is honoured, so the production name is not untested:

```ts
  it('accepts a session under the __Host- name', async () => {
    const { createSessionToken } = await import('../auth/session')
    const token = await createSessionToken('me@example.com', TEST_SESSION_SECRET)
    const response = await app.request('/api/habits', {
      headers: { cookie: `__Host-habit_session=${token}` },
    })
    expect(response.status).toBe(200)
  })
```

- [ ] **Step 8: Run everything**

Run: `npx vitest run`
Expected: **157 passing** — 147 existing, 9 from `request.spec.ts`, 1 new cookie-name test.

- [ ] **Step 9: Typecheck, build, commit**

```bash
pnpm typecheck && pnpm build
```

```bash
git add -A
git commit -m "fix(auth): derive cookie security from the forwarded protocol (D-15)

Vercel terminates TLS at its edge, so the function sees a plain http
request and the old URL-based derivation would have silently dropped
Secure from the production cookie.

x-forwarded-proto is now the authority, with the request URL as the local
fallback, and the first entry of a proxy chain is the client-facing hop.

The cookie also takes the __Host- prefix when the request is secure, which
blocks a sibling deployment on the same apex from planting one. Browsers
reject __Host- without Secure, so local http keeps the plain name and the
reader accepts either — a session issued before a protocol change is still
honoured rather than silently logged out."
```

---

### Task 2: The Vercel function and configuration

Everything needed to deploy, without deploying. Nothing here is exposed until Task 3.

**Files:**
- Create: `api/index.ts`, `vercel.json`, `.vercelignore`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-09-13-hosted-migration-design.md` (record D-16)

**Interfaces:**
- Consumes: `createApp()` from `server/app.ts`
- Produces: a deployable configuration; nothing later tasks import

- [ ] **Step 1: Create the serverless function**

Create `api/index.ts`:

```ts
import { handle } from 'hono/vercel'
import { createApp } from '../server/app'

// One catch-all function for the whole API. `handle` simply forwards the
// incoming Request to the Hono app, so no route needs to know it is running
// on Vercel.
export default handle(createApp())

// The Node runtime, not Edge: the Neon driver opens a WebSocket pool, which
// needs a Node environment (D-16).
export const config = {
  runtime: 'nodejs',
}
```

Note there is no `dotenv` import here. Vercel injects environment variables directly; `server/index.ts` keeps its `dotenv/config` for local development and is not used in production.

- [ ] **Step 2: Record the driver decision**

Append to the spec, after D-15:

```markdown
**D-16 — the Neon WebSocket pool stays, and the function runs on the Node
runtime.** `neon-http` cannot be used because `PUT /api/log/:date` needs a real
transaction (D-14), and a WebSocket pool needs Node rather than Edge. The cost
is a connection handshake on each cold start, and connections that may be
dropped while a function is frozen — which is exactly why the pool carries an
`error` listener, without which a dropped idle connection is an uncaught
exception. Splitting the driver (HTTP for reads, pool for the one transactional
route) would avoid the handshake at the price of two clients and two code paths;
that is not worth it for a single-user app, and the decision should be revisited
only if cold starts become a real complaint.
```

- [ ] **Step 3: Route requests**

Create `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "pnpm build",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

The second rewrite is what makes the SPA router work: a deep link like `/log?date=2026-09-13` is not a file on disk, and without this it would 404 instead of reaching `index.html`. The negative lookahead keeps `/api/*` from being swallowed by it.

- [ ] **Step 4: Keep local-only files out of the deployment**

Create `.vercelignore`:

```
.superpowers
docs
bruno
*.md
!README.md
```

- [ ] **Step 5: Add the production migration command**

In `package.json` scripts, add:

```json
"db:migrate:prod": "dotenv -e .env.production -- tsx scripts/migrate.ts"
```

and install what it needs:

```bash
pnpm add -D dotenv-cli
```

`.env.production` holds the **production** Neon connection string and is never committed — add it to `.gitignore` alongside `.env`:

```
.env.production
```

While in that file: `.env` is currently listed **twice** (once from the fix applied directly to `main`, once from the Neon migration branch). Harmless, but delete the duplicate so the file reads as deliberate.

This keeps migrations a deliberate act against an explicitly named environment (D-13), rather than something a build does on its own.

- [ ] **Step 6: Verify the build still works and nothing leaked**

```bash
pnpm typecheck && npx vitest run && pnpm build
```
Expected: typecheck clean, 157 passing, build succeeds.

```bash
git status --porcelain --ignored | grep -E "\.env" || echo "no env files staged"
```
Expected: any `.env*` files show as ignored, never as staged.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(deploy): Vercel function, rewrites and a production migration command

One catch-all function exports the existing Hono app through hono/vercel,
so no route changes. The SPA rewrite is what stops a deep link like
/log?date=... 404ing before it reaches index.html.

Migrations get their own command against an explicitly named environment
rather than running in the build: Vercel builds on every push, and a
migrating build ships a bad schema change the moment it is committed
(D-13). Records D-16 on why the WebSocket pool and Node runtime stay."
```

---

### Task 3: Deploy and verify

**Do not start this task until sign-in has been verified working locally.** See the gate at the top of this plan. Deploying an unexercised login is precisely the exposure the spec's phase ordering exists to prevent.

**Files:** none — this task produces no code.

**Interfaces:**
- Consumes: everything from Tasks 1–2
- Produces: a running deployment

- [ ] **Step 1: Confirm the gate**

Ask the human partner to confirm that signing in with the allowed Google account works locally, and that an account **not** on the allowlist is refused with 403. If either has not been demonstrated, stop here and say so — this is not a judgement call to make alone.

- [ ] **Step 2: Ask for the production environment**

A Vercel project cannot be created from here. Ask the human partner to:

1. Create a **production branch** in the Neon project, separate from `dev`, and copy its pooled connection string.
2. Import the repository at `vercel.com/new`, selecting the **Vite** preset.
3. Set these Environment Variables on the Vercel project, all for Production:
   - `DATABASE_URL` — the **production** Neon branch, not `dev`
   - `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` — the same value
   - `ALLOWED_EMAILS` — their address
   - `SESSION_SECRET` — a **new** value from `openssl rand -base64 32`, not the local one
4. Add the deployed origin (`https://<project>.vercel.app`) to the OAuth client's **Authorised JavaScript origins**, alongside `http://localhost:5173`. Without this the Google button will not render in production.

`VITE_GOOGLE_CLIENT_ID` is read at **build** time, so it must exist before the first build, and changing it later requires a redeploy rather than just a restart.

- [ ] **Step 3: Migrate the production database**

Locally, create `.env.production` holding only the production `DATABASE_URL`, then:

```bash
pnpm db:migrate:prod
```

Expected: migrations applied, and the host printed is the **production** branch. Do not run `db:seed` yet — confirm the schema first.

- [ ] **Step 4: Seed the four habits**

```bash
dotenv -e .env.production -- tsx scripts/seed.ts
```

Expected: `Seeded 4 habits.` It is a no-op if any habit already exists, so it cannot duplicate.

- [ ] **Step 5: Verify D-15 on a real response — the check this phase exists for**

This is the one thing that could not be verified locally, and the whole reason D-15 was recorded.

```bash
curl -s -i -X POST https://<project>.vercel.app/api/auth/logout \
  -H 'content-type: application/json' | grep -i 'set-cookie'
```

Expected: the `Set-Cookie` header names **`__Host-habit_session`** and carries **`Secure`**.

If it shows the plain `habit_session` name or lacks `Secure`, then `x-forwarded-proto` is not arriving as expected and **the fix has not worked** — stop, report it, and do not treat the deployment as sound. A missing `Secure` on a public URL means the session cookie can travel over plain http.

- [ ] **Step 6: Verify the guard from outside**

```bash
curl -s -o /dev/null -w 'habits: %{http_code}\n' https://<project>.vercel.app/api/habits
curl -s -o /dev/null -w 'health: %{http_code}\n' https://<project>.vercel.app/api/health
```

Expected: `habits: 401`, `health: 200`. An unauthenticated request must not reach data from the public internet.

- [ ] **Step 7: Verify the app in a browser**

1. Visit the deployment signed out → redirected to `/login`.
2. Sign in with the allowed Google account → the dashboard, with the four habits.
3. Reload → still signed in.
4. Deep-link straight to `/habits` → it loads rather than 404ing, proving the SPA rewrite.
5. Log a day, then reload → the entry persists.
6. Sign out → back at `/login`, and Step 6's curl still returns 401.

- [ ] **Step 8: Verify the allowlist excludes, in production**

Temporarily set `ALLOWED_EMAILS` on Vercel to an address that is **not** the signing-in account, redeploy, clear cookies, and attempt to sign in. Expected: **403**, no session. Restore the real value and redeploy afterwards, confirming sign-in works again.

This is the requirement the whole auth phase exists for. Verify it in production, not only locally.

- [ ] **Step 9: Report**

No commit — this task produces no tracked files. Report what was verified, and in particular the exact `Set-Cookie` header observed in Step 5.

---

## Done when

- `pnpm typecheck`, `npx vitest run` (157) and `pnpm build` all pass, suite still network-free.
- The deployed URL serves the app, and deep links resolve rather than 404.
- `Set-Cookie` on a production response names `__Host-habit_session` and carries `Secure`.
- An unauthenticated request to `/api/habits` returns 401 from the public internet; `/api/health` returns 200.
- Signing in with the allowed account works and survives a reload; an account not on the allowlist is refused with 403 **in production**.
- No secret appears in any log, commit, or committed file.
