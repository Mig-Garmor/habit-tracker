# Phase 2 — Google Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the whole app behind a Google sign-in restricted to a single email address, so it can be deployed publicly in Phase 3 without exposing personal habit data.

**Architecture:** The browser gets a signed Google **ID token** from Google Identity Services and posts it to the API. The server verifies that token against Google's public keys, checks the email against an allowlist held in configuration, and issues its own short signed session JWT in an httpOnly cookie. Hono middleware then rejects any `/api` request without a valid session. The client keeps a router guard for UX only — the server is the actual security boundary.

**Tech Stack:** `jose` (both Google token verification and session signing), Google Identity Services, Hono cookie helpers, Vue 3 + vue-router v5, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-13-hosted-migration-design.md` — read it alongside this plan. Decisions **D-10, D-11, D-12** govern this phase; D-1 through D-9 and D-14 describe behaviour it must not disturb.

## Global Constraints

- **The server is the security boundary, never the client.** The router guard exists so the UI does not flash; it protects nothing. Every `/api` route must reject an unauthenticated request on its own.
- **The allowlist lives in `ALLOWED_EMAILS`, never in the database** (D-10). In the database it is a chicken-and-egg — you would need to be signed in to manage the row that lets you sign in — and a bad migration could lock the only user out permanently.
- **Sessions are stateless signed JWTs in an httpOnly cookie** (D-11), not database rows. Serverless functions share no memory and a session table would mean a database round trip per request.
- **`jose` does both jobs** (D-12): verifying Google's token and signing ours. One dependency, and it works in Node and edge runtimes alike.
- **Nothing may log, echo or commit a secret.** `SESSION_SECRET`, the Google credential and the session cookie value never appear in a log line, an error message, a report or a commit.
- `noUnusedLocals` and `noUnusedParameters` are on for `server/**` — an unused import is a build failure.
- `pnpm typecheck`, `npx vitest run` and `pnpm build` must all pass before every commit.
- **Node 22+** (`package.json` already declares `engines`). `jose` uses WebCrypto, which is global from Node 20 — no polyfill needed.

## The cost this plan names up front

**Adding the middleware breaks all 33 existing route tests at once.** `server/routes/habits.spec.ts` (14) and `server/routes/log.spec.ts` (19) call `/api/*` with no cookie and would every one return 401. They are re-armed with a real session cookie in Task 2 — deliberately *with* a real cookie rather than by bypassing the guard, so the tests keep exercising the thing that protects the data. This is the phase's equivalent of Phase 1's pglite conversion, and it is not optional.

## File Structure

**Server — pure, no IO, fully testable:**
- `server/auth/allowlist.ts` *(create)* — parse and match the allowlist
- `server/auth/session.ts` *(create)* — sign and read session tokens

**Server — IO edges:**
- `server/auth/google.ts` *(create)* — verify a Google ID token against Google's JWKS
- `server/auth/cookie.ts` *(create)* — the cookie name and its attributes in one place
- `server/routes/auth.ts` *(create)* — the three auth endpoints
- `server/middleware/require-session.ts` *(create)* — the guard
- `server/app.ts` *(modify)* — mount the routes and apply the guard

**Tests:**
- `server/auth/allowlist.spec.ts`, `server/auth/session.spec.ts` *(create)* — pure TDD
- `server/routes/auth.spec.ts` *(create)* — the guard and the endpoints
- `server/test/session-cookie.ts` *(create)* — a helper both existing specs use to authenticate
- `server/routes/habits.spec.ts`, `server/routes/log.spec.ts` *(modify)* — send a session cookie

**Client:**
- `src/lib/auth.ts` *(create)* — session state, shared across components
- `src/pages/login.vue` + `.scss` *(create)*
- `src/main.ts` *(modify)* — the router guard
- `src/lib/api.ts` *(modify)* — a 401 sends you to `/login`
- `src/App.vue` / `App.scss` *(modify)* — a sign-out control

**Config:**
- `.env.example` *(modify)*, `README.md` *(modify)*

---

### Task 1: The pure auth primitives

Allowlist matching and session signing, both with no network and no framework. Everything security-critical that *can* be pure is pure, so it can be tested exhaustively.

**Files:**
- Create: `server/auth/allowlist.ts`, `server/auth/allowlist.spec.ts`
- Create: `server/auth/session.ts`, `server/auth/session.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `parseAllowlist(raw: string | undefined): string[]`
  - `isAllowed(email: string, allowlist: string[]): boolean`
  - `SESSION_MAX_AGE_SECONDS: number`
  - `createSessionToken(email: string, secret: string): Promise<string>`
  - `readSessionToken(token: string, secret: string): Promise<string | null>` — returns the email, or null for anything invalid

- [ ] **Step 1: Install jose**

```bash
pnpm add jose
```

- [ ] **Step 2: Write the failing allowlist test**

Create `server/auth/allowlist.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isAllowed, parseAllowlist } from './allowlist'

describe('parseAllowlist', () => {
  it('splits a comma-separated list', () => {
    expect(parseAllowlist('a@example.com,b@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })

  it('trims whitespace around entries', () => {
    expect(parseAllowlist(' a@example.com , b@example.com ')).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })

  it('lowercases entries so matching is case-insensitive', () => {
    expect(parseAllowlist('Me@Example.COM')).toEqual(['me@example.com'])
  })

  it('drops empty entries from stray commas', () => {
    expect(parseAllowlist('a@example.com,,')).toEqual(['a@example.com'])
  })

  it('is empty for undefined or blank', () => {
    expect(parseAllowlist(undefined)).toEqual([])
    expect(parseAllowlist('   ')).toEqual([])
  })
})

describe('isAllowed', () => {
  const allowlist = ['me@example.com']

  it('accepts an exact match', () => {
    expect(isAllowed('me@example.com', allowlist)).toBe(true)
  })

  it('accepts a differently-cased address', () => {
    expect(isAllowed('Me@Example.com', allowlist)).toBe(true)
  })

  it('rejects anyone else', () => {
    expect(isAllowed('someone@example.com', allowlist)).toBe(false)
  })

  // An empty allowlist must lock everyone out. The opposite — treating "no
  // list" as "anyone" — would silently open the app the moment the variable
  // went missing in production.
  it('rejects everyone when the allowlist is empty', () => {
    expect(isAllowed('me@example.com', [])).toBe(false)
  })

  it('rejects an empty address', () => {
    expect(isAllowed('', allowlist)).toBe(false)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run server/auth/allowlist.spec.ts`
Expected: FAIL — cannot find module `./allowlist`.

- [ ] **Step 4: Implement the allowlist**

Create `server/auth/allowlist.ts`:

```ts
/**
 * Who may sign in. Held in configuration rather than the database (D-10): in
 * the database you would need to be signed in to manage the row that lets you
 * sign in, and a bad migration could lock the only user out for good.
 */
export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry.length > 0)
}

/**
 * Fails closed: an empty allowlist admits nobody. Treating "no list" as
 * "anyone" would open the app the moment the variable went missing.
 */
export function isAllowed(email: string, allowlist: string[]): boolean {
  if (!email) return false
  return allowlist.includes(email.trim().toLowerCase())
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run server/auth/allowlist.spec.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Write the failing session test**

Create `server/auth/session.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createSessionToken, readSessionToken, SESSION_MAX_AGE_SECONDS } from './session'

const SECRET = 'a-test-secret-that-is-at-least-32-bytes-long'
const OTHER_SECRET = 'a-different-secret-also-at-least-32-bytes'

describe('session tokens', () => {
  it('round-trips the email', async () => {
    const token = await createSessionToken('me@example.com', SECRET)
    expect(await readSessionToken(token, SECRET)).toBe('me@example.com')
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken('me@example.com', OTHER_SECRET)
    expect(await readSessionToken(token, SECRET)).toBeNull()
  })

  it('rejects a tampered payload', async () => {
    const token = await createSessionToken('me@example.com', SECRET)
    const [header, , signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: 'attacker@example.com' })).toString('base64url')
    expect(await readSessionToken(`${header}.${forged}.${signature}`, SECRET)).toBeNull()
  })

  it('rejects a token that is not a JWT at all', async () => {
    expect(await readSessionToken('not-a-token', SECRET)).toBeNull()
    expect(await readSessionToken('', SECRET)).toBeNull()
  })

  it('rejects an expired token', async () => {
    // Signed as already expired rather than waiting out a real clock.
    const { SignJWT } = await import('jose')
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('me@example.com')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(SECRET))

    expect(await readSessionToken(expired, SECRET)).toBeNull()
  })

  it('expires in 30 days', () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30)
  })
})
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npx vitest run server/auth/session.spec.ts`
Expected: FAIL — cannot find module `./session`.

- [ ] **Step 8: Implement sessions**

Create `server/auth/session.ts`:

```ts
import { SignJWT, jwtVerify } from 'jose'

/** Thirty days. Long enough not to nag, short enough to bound a stolen laptop. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

const ALGORITHM = 'HS256'

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

/**
 * Our own session token, not Google's. Stateless by design (D-11): serverless
 * functions share no memory, and a session table would mean a database round
 * trip on every request to a single-user app.
 */
export async function createSessionToken(email: string, secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(key(secret))
}

/**
 * The email the token vouches for, or null for anything at all wrong with it —
 * bad signature, tampering, expiry, malformed. Callers get one clear answer and
 * cannot accidentally treat a failure as a success.
 */
export async function readSessionToken(token: string, secret: string): Promise<string | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: [ALGORITHM] })
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null
  } catch {
    return null
  }
}
```

- [ ] **Step 9: Run it and watch it pass**

Run: `npx vitest run server/auth/session.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 10: Full suite, typecheck, commit**

```bash
npx vitest run && pnpm typecheck
```
Expected: 127 tests passing (110 existing + 17 new).

```bash
git add server/auth package.json pnpm-lock.yaml
git commit -m "feat(auth): allowlist matching and signed session tokens

Both pure and exhaustively tested: the allowlist fails closed when empty,
and a session token is rejected for a wrong secret, a tampered payload,
expiry, or not being a JWT at all."
```

---

### Task 2: Google verification, the auth endpoints, and the guard

The server side, end to end. **Atomic**: the moment the guard is mounted, every existing route test starts returning 401, so re-arming them belongs in this task rather than a later one.

**Files:**
- Create: `server/auth/google.ts`, `server/auth/cookie.ts`
- Create: `server/routes/auth.ts`, `server/middleware/require-session.ts`
- Create: `server/routes/auth.spec.ts`, `server/test/session-cookie.ts`
- Modify: `server/app.ts`
- Modify: `server/routes/habits.spec.ts`, `server/routes/log.spec.ts`

**Interfaces:**
- Consumes: `parseAllowlist`, `isAllowed` from `../auth/allowlist`; `createSessionToken`, `readSessionToken`, `SESSION_MAX_AGE_SECONDS` from `../auth/session`
- Produces:
  - `verifyGoogleIdToken(credential: string, clientId: string): Promise<string | null>` — the verified email, or null
  - `SESSION_COOKIE: string`, `sessionCookieOptions(url: string): CookieOptions`
  - `authRoutes` — a Hono app mounted at `/api/auth`
  - `requireSession()` — Hono middleware; sets `c.get('email')` on success
  - `signedCookieHeader(email: string): Promise<string>` from `server/test/session-cookie.ts`

- [ ] **Step 1: Verify Google ID tokens**

Create `server/auth/google.ts`. The issuer, JWKS URI and RS256 algorithm below were read from Google's live discovery document at `https://accounts.google.com/.well-known/openid-configuration`:

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose'

const GOOGLE_ISSUER = 'https://accounts.google.com'
const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs')

// Created once: the set caches Google's keys and refreshes them on its own.
const jwks = createRemoteJWKSet(GOOGLE_JWKS_URL)

interface GoogleIdTokenClaims {
  email?: unknown
  email_verified?: unknown
}

/**
 * The verified email address from a Google ID token, or null if the token is
 * not one we should trust. Checks the signature against Google's published
 * keys, that the token was issued for THIS client, that Google issued it, that
 * it has not expired, and that Google considers the address verified.
 */
export async function verifyGoogleIdToken(
  credential: string,
  clientId: string,
): Promise<string | null> {
  if (!credential || !clientId) return null

  try {
    const { payload } = await jwtVerify<GoogleIdTokenClaims>(credential, jwks, {
      issuer: GOOGLE_ISSUER,
      audience: clientId,
      algorithms: ['RS256'],
    })

    // An unverified address could be anyone's; Google only vouches for verified ones.
    if (payload.email_verified !== true) return null
    return typeof payload.email === 'string' && payload.email.length > 0 ? payload.email : null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Put the cookie's shape in one place**

Create `server/auth/cookie.ts`:

```ts
import type { CookieOptions } from 'hono/utils/cookie'
import { SESSION_MAX_AGE_SECONDS } from './session'

export const SESSION_COOKIE = 'habit_session'

/**
 * `secure` is derived from the request rather than hardcoded: Safari refuses a
 * Secure cookie over plain http, which would make local development silently
 * fail to keep anyone signed in.
 *
 * SameSite=Lax plus a same-origin API is our CSRF defence — the mutating routes
 * all take `content-type: application/json`, which a browser will not send
 * cross-origin without a preflight the server never grants.
 */
export function sessionCookieOptions(requestUrl: string): CookieOptions {
  return {
    httpOnly: true,
    secure: new URL(requestUrl).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  }
}
```

- [ ] **Step 3: Write the guard**

Create `server/middleware/require-session.ts`:

```ts
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { SESSION_COOKIE } from '../auth/cookie'
import { readSessionToken } from '../auth/session'

/**
 * The actual security boundary. The client's router guard only stops the UI
 * flashing; this is what protects the data.
 */
export function requireSession(): MiddlewareHandler {
  return async (c, next) => {
    const secret = process.env.SESSION_SECRET
    // A missing secret must not mean "let everyone in".
    if (!secret) return c.json({ error: 'Not signed in' }, 401)

    const email = await readSessionToken(getCookie(c, SESSION_COOKIE) ?? '', secret)
    if (!email) return c.json({ error: 'Not signed in' }, 401)

    c.set('email', email)
    await next()
  }
}
```

- [ ] **Step 4: Write the auth endpoints**

Create `server/routes/auth.ts`:

```ts
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { isAllowed, parseAllowlist } from '../auth/allowlist'
import { SESSION_COOKIE, sessionCookieOptions } from '../auth/cookie'
import { verifyGoogleIdToken } from '../auth/google'
import { createSessionToken, readSessionToken } from '../auth/session'

export const authRoutes = new Hono()

authRoutes.post('/session', async c => {
  const secret = process.env.SESSION_SECRET
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!secret || !clientId) {
    console.error('SESSION_SECRET or GOOGLE_CLIENT_ID is not configured')
    return c.json({ error: 'Sign-in is not configured on the server' }, 500)
  }

  const body = await c.req.json<{ credential?: unknown }>().catch(() => ({ credential: undefined }))
  if (typeof body.credential !== 'string') {
    return c.json({ error: 'Missing Google credential' }, 400)
  }

  const email = await verifyGoogleIdToken(body.credential, clientId)
  if (!email) return c.json({ error: 'Could not verify that Google account' }, 401)

  if (!isAllowed(email, parseAllowlist(process.env.ALLOWED_EMAILS))) {
    // Deliberately does not say whether the address exists or the list is empty.
    return c.json({ error: 'That account is not allowed to use this app' }, 403)
  }

  setCookie(c, SESSION_COOKIE, await createSessionToken(email, secret), sessionCookieOptions(c.req.url))
  return c.json({ email })
})

authRoutes.get('/me', async c => {
  const secret = process.env.SESSION_SECRET
  if (!secret) return c.json({ error: 'Not signed in' }, 401)

  const email = await readSessionToken(getCookie(c, SESSION_COOKIE) ?? '', secret)
  if (!email) return c.json({ error: 'Not signed in' }, 401)

  return c.json({ email })
})

authRoutes.post('/logout', c => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})
```

- [ ] **Step 5: Mount them and apply the guard**

Replace the body of `createApp()` in `server/app.ts`:

```ts
import { Hono } from 'hono'
import { requireSession } from './middleware/require-session'
import { authRoutes } from './routes/auth'
import { dashboardRoutes } from './routes/dashboard'
import { habitsRoutes } from './routes/habits'
import { logRoutes } from './routes/log'

/**
 * Builds the API. Kept separate from index.ts so tests can call app.request()
 * without binding a port.
 */
export function createApp() {
  const app = new Hono<{ Variables: { email: string } }>()

  // Open: health reveals nothing, and auth is how a session is obtained.
  app.get('/api/health', c => c.json({ ok: true }))
  app.route('/api/auth', authRoutes)

  // Everything below this line requires a session.
  app.use('/api/*', requireSession())

  app.route('/api/habits', habitsRoutes)
  app.route('/api/dashboard', dashboardRoutes)
  app.route('/api/log', logRoutes)

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Something went wrong' }, 500)
  })

  return app
}
```

Middleware registered with `app.use` only applies to routes registered *after* it, which is why health and auth are mounted above the line.

- [ ] **Step 6: Give the existing tests a way to authenticate**

Create `server/test/session-cookie.ts`:

```ts
import { SESSION_COOKIE } from '../auth/cookie'
import { createSessionToken } from '../auth/session'

/** The secret the route tests sign with. Set into the environment by each spec. */
export const TEST_SESSION_SECRET = 'test-session-secret-at-least-32-bytes-long'

/**
 * A Cookie header carrying a real, validly signed session. The existing route
 * tests authenticate rather than bypass the guard, so they keep exercising the
 * thing that actually protects the data.
 */
export async function signedCookieHeader(email = 'tester@example.com'): Promise<string> {
  return `${SESSION_COOKIE}=${await createSessionToken(email, TEST_SESSION_SECRET)}`
}
```

- [ ] **Step 7: Write the auth route tests**

Create `server/routes/auth.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { signedCookieHeader, TEST_SESSION_SECRET } from '../test/session-cookie'
import { createTestDb } from '../test/pg-harness'

const holder = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock('../db/client', () => ({
  get db() {
    return holder.db
  },
}))

let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }
let close: () => Promise<void>

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SESSION_SECRET
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
  process.env.ALLOWED_EMAILS = 'me@example.com'

  const harness = await createTestDb()
  holder.db = harness.db
  close = harness.close
  app = (await import('../app')).createApp()
})

afterAll(async () => {
  await close()
})

describe('the guard', () => {
  it('refuses an API request with no cookie', async () => {
    const response = await app.request('/api/habits')
    expect(response.status).toBe(401)
  })

  it('refuses a cookie signed with the wrong secret', async () => {
    const { createSessionToken } = await import('../auth/session')
    const forged = await createSessionToken('me@example.com', 'a-completely-different-secret-32b')
    const response = await app.request('/api/habits', {
      headers: { cookie: `habit_session=${forged}` },
    })
    expect(response.status).toBe(401)
  })

  it('refuses a garbage cookie', async () => {
    const response = await app.request('/api/habits', {
      headers: { cookie: 'habit_session=not-a-token' },
    })
    expect(response.status).toBe(401)
  })

  it('allows a validly signed cookie', async () => {
    const response = await app.request('/api/habits', {
      headers: { cookie: await signedCookieHeader() },
    })
    expect(response.status).toBe(200)
  })

  it('leaves /api/health open', async () => {
    expect((await app.request('/api/health')).status).toBe(200)
  })
})

describe('POST /api/auth/session', () => {
  function post(body: unknown) {
    return app.request('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('rejects a missing credential', async () => {
    expect((await post({})).status).toBe(400)
  })

  it('rejects a credential that is not a string', async () => {
    expect((await post({ credential: 12345 })).status).toBe(400)
  })

  it('rejects a credential Google will not vouch for', async () => {
    // Not a real Google token, so JWKS verification fails and no session is issued.
    expect((await post({ credential: 'made.up.token' })).status).toBe(401)
  })
})

describe('GET /api/auth/me', () => {
  it('is 401 without a session', async () => {
    expect((await app.request('/api/auth/me')).status).toBe(401)
  })

  it('returns the email with a session', async () => {
    const response = await app.request('/api/auth/me', {
      headers: { cookie: await signedCookieHeader('me@example.com') },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ email: 'me@example.com' })
  })
})

describe('POST /api/auth/logout', () => {
  it('clears the cookie', async () => {
    const response = await app.request('/api/auth/logout', { method: 'POST' })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('habit_session=')
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0|Expires=/i)
  })
})
```

- [ ] **Step 8: Re-arm the two existing route specs**

Both `server/routes/habits.spec.ts` and `server/routes/log.spec.ts` now need a session on every request.

In each file, add to the imports:

```ts
import { signedCookieHeader, TEST_SESSION_SECRET } from '../test/session-cookie'
```

In each `beforeAll`, **before** the app is created, set the secret and build the header once:

```ts
  process.env.SESSION_SECRET = TEST_SESSION_SECRET
  cookie = await signedCookieHeader()
```

with `let cookie: string` declared alongside the other module-level `let`s.

Then give every request that header. The helpers gain it directly — in `habits.spec.ts`:

```ts
function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

function patch(path: string, body: unknown) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}
```

and the bare `app.request('/api/habits…')` calls inside tests become:

```ts
app.request('/api/habits', { headers: { cookie } })
```

Do the same throughout `log.spec.ts` — its `put` helper and every bare `app.request` call. **Do not change a single assertion.** Every test must still assert exactly what it asserted before; the only difference is that each request now carries a session.

- [ ] **Step 9: Run everything**

Run: `npx vitest run`
Expected: **138 passing** — 110 existing (including the 33 re-armed route tests, still passing with their original assertions), 17 from Task 1, and 11 from `auth.spec.ts`.

If route tests fail with 401, the cookie is not reaching them; if they fail on a value, something in Step 8 changed behaviour rather than just adding a header.

- [ ] **Step 10: Typecheck, build, commit**

```bash
pnpm typecheck && pnpm build
```

```bash
git add server .
git commit -m "feat(auth): verify Google tokens and guard every API route

The browser's Google ID token is verified against Google's published keys,
checked for this client id, this issuer, expiry and email_verified, then
matched against an allowlist held in configuration. Only then does the
server issue its own session cookie.

Hono middleware now rejects any /api request without a valid session;
only /api/health and /api/auth/* are open.

The 33 existing route tests authenticate with a real signed cookie rather
than bypassing the guard, so they keep exercising what protects the data.
Not one assertion changed."
```

---

### Task 3: The login page, session state and the router guard

**Files:**
- Create: `src/lib/auth.ts`, `src/pages/login.vue`, `src/pages/login.scss`
- Modify: `src/main.ts`, `src/lib/api.ts`, `src/App.vue`, `src/App.scss`, `index.html`

**Interfaces:**
- Consumes: `/api/auth/session`, `/api/auth/me`, `/api/auth/logout` from Task 2
- Produces: `useAuth()` returning `{ email, status, loadSession, signIn, signOut }` where `status` is `'unknown' | 'in' | 'out'`

- [ ] **Step 1: Load Google Identity Services**

In `index.html`, add inside `<head>`:

```html
    <script src="https://accounts.google.com/gsi/client" async defer></script>
```

- [ ] **Step 2: Write the session store**

Create `src/lib/auth.ts`:

```ts
import { ref } from 'vue'

export type AuthStatus = 'unknown' | 'in' | 'out'

// Module-level so every component and the router guard share one answer
// rather than each asking the server again.
const email = ref<string | null>(null)
const status = ref<AuthStatus>('unknown')

async function loadSession(): Promise<AuthStatus> {
  try {
    const response = await fetch('/api/auth/me')
    if (response.ok) {
      const body = (await response.json()) as { email: string }
      email.value = body.email
      status.value = 'in'
    } else {
      email.value = null
      status.value = 'out'
    }
  } catch {
    // The API being unreachable is not the same as being signed out, but the
    // only safe assumption for a guard is that we are not signed in.
    email.value = null
    status.value = 'out'
  }
  return status.value
}

/** Exchanges a Google credential for a session cookie. Throws with the server's message. */
async function signIn(credential: string): Promise<void> {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential }),
  })

  if (!response.ok) {
    const message = await response
      .json()
      .then((body: { error?: unknown }) => (typeof body.error === 'string' ? body.error : null))
      .catch(() => null)
    throw new Error(message ?? 'Could not sign in')
  }

  const body = (await response.json()) as { email: string }
  email.value = body.email
  status.value = 'in'
}

async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
  email.value = null
  status.value = 'out'
}

/** Marks the session stale without a request — used when the API returns 401. */
function clearSession(): void {
  email.value = null
  status.value = 'out'
}

export function useAuth() {
  return { email, status, loadSession, signIn, signOut, clearSession }
}
```

- [ ] **Step 3: Write the login page**

Create `src/pages/login.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/lib/auth'

interface GoogleCredentialResponse { credential?: string }

interface GoogleAccountsId {
  initialize: (config: { client_id: string, callback: (r: GoogleCredentialResponse) => void }) => void
  renderButton: (el: HTMLElement, options: Record<string, string>) => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

const router = useRouter()
const { signIn } = useAuth()

const buttonHost = ref<HTMLElement | null>(null)
const error = ref<string | null>(null)

async function handleCredential(response: GoogleCredentialResponse) {
  error.value = null
  if (!response.credential) {
    error.value = 'Google did not return a credential.'
    return
  }
  try {
    await signIn(response.credential)
    await router.replace('/')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not sign in.'
  }
}

onMounted(() => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) {
    error.value = 'VITE_GOOGLE_CLIENT_ID is not set. Add it to .env and restart the dev server.'
    return
  }
  // The GSI script is loaded async in index.html, so it may not be ready yet.
  const start = () => {
    if (!window.google || !buttonHost.value) {
      window.setTimeout(start, 50)
      return
    }
    window.google.accounts.id.initialize({ client_id: clientId, callback: handleCredential })
    window.google.accounts.id.renderButton(buttonHost.value, { theme: 'outline', size: 'large' })
  }
  start()
})
</script>

<template>
  <div class="login">
    <h1 class="login__title">Habit Tracker</h1>
    <p class="login__lead">Sign in to continue.</p>
    <div ref="buttonHost" class="login__button"></div>
    <p v-if="error" class="login__error">{{ error }}</p>
  </div>
</template>

<style lang="scss" scoped src="./login.scss"></style>
```

Create `src/pages/login.scss`:

```scss
.login {
  @apply mx-auto flex w-full max-w-sm flex-col items-center gap-4 py-16 text-center;

  &__title {
    @apply text-xl font-semibold tracking-tight;
  }

  &__lead {
    @apply text-sm text-muted-foreground;
  }

  &__button {
    @apply min-h-10;
  }

  &__error {
    @apply text-sm text-destructive;
  }
}
```

- [ ] **Step 4: Guard the routes**

Replace `src/main.ts`:

```ts
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { handleHotUpdate, routes } from 'vue-router/auto-routes'
import App from './App.vue'
import { useAuth } from './lib/auth'
import './styles/main.scss'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

if (import.meta.hot) {
  handleHotUpdate(router)
}

/**
 * Convenience, not security — it only stops the UI flashing content before the
 * server refuses it. Every /api route rejects an unauthenticated request on its
 * own, and that is what actually protects the data.
 */
router.beforeEach(async to => {
  const { status, loadSession } = useAuth()
  const current = status.value === 'unknown' ? await loadSession() : status.value

  if (current === 'out' && to.path !== '/login') return '/login'
  if (current === 'in' && to.path === '/login') return '/'
  return true
})

createApp(App).use(router).mount('#app')
```

- [ ] **Step 5: Make a 401 send you to the login page**

In `src/lib/api.ts`, add the import:

```ts
import { useAuth } from './auth'
```

and at the top of the `!response.ok` branch in `json<T>()`, before the unreachable-status check:

```ts
    if (response.status === 401) {
      // An expired or missing session should read as "sign in again", not as a
      // generic failure on whichever screen happened to be open.
      useAuth().clearSession()
      window.location.assign('/login')
      throw new Error('Your session has expired. Please sign in again.')
    }
```

- [ ] **Step 6: Add a sign-out control**

In `src/App.vue`, add to the script:

```ts
import { useAuth } from '@/lib/auth'

const { email, signOut } = useAuth()

async function handleSignOut() {
  await signOut()
  window.location.assign('/login')
}
```

and at the end of the `<nav>` block:

```vue
        <button v-if="email" type="button" class="app__signout" @click="handleSignOut">
          Sign out
        </button>
```

In `src/App.scss`, inside `.app`, add:

```scss
  &__signout {
    @apply ml-auto text-sm text-muted-foreground transition-colors;

    &:hover {
      @apply text-foreground;
    }
  }
```

- [ ] **Step 7: Verify what can be verified without Google**

Run: `npx vitest run && pnpm typecheck && pnpm build`
Expected: 138 passing, typecheck clean, build succeeds.

The sign-in flow itself cannot be exercised until Task 4 supplies a Google client id — there is nothing to sign in *with*. Do not attempt to fake it.

- [ ] **Step 8: Commit**

```bash
git add src index.html
git commit -m "feat(web): login page, shared session state and a router guard

The guard is convenience only — it stops the UI flashing content the
server would refuse. A 401 from any API call now clears local session
state and sends you to /login rather than surfacing as a generic error."
```

---

### Task 4: Configuration, documentation, and end-to-end verification

The first task that needs a real Google OAuth client, which only a human can create.

**Files:**
- Modify: `.env.example`, `README.md`

**Interfaces:**
- Consumes: everything from Tasks 1–3
- Produces: nothing; this is the verification gate

- [ ] **Step 1: Document the configuration**

Append to `.env.example`:

```bash

# Google OAuth client id. Create one at console.cloud.google.com ->
# APIs & Services -> Credentials -> Create OAuth client ID -> Web application.
# Add http://localhost:5173 as an authorised JavaScript origin.
# The two names hold the same value: Vite only exposes VITE_-prefixed
# variables to the browser, so the login page cannot read the first one.
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com

# Who may sign in. Comma-separated. An empty list admits nobody.
ALLOWED_EMAILS=you@gmail.com

# Signs the session cookie. Generate with: openssl rand -base64 32
SESSION_SECRET=replace-me-with-at-least-32-random-bytes
```

- [ ] **Step 2: Ask the human partner for a Google client id**

Stop and ask. They need to:

1. Go to `console.cloud.google.com` → APIs & Services → Credentials.
2. Create an **OAuth client ID**, application type **Web application**.
3. Add `http://localhost:5173` under **Authorised JavaScript origins**. Without this the Google button will not render at all locally.
4. Copy the client id.

Then locally they add to `.env`: `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` (same value), `ALLOWED_EMAILS` set to their own Google address, and `SESSION_SECRET` from `openssl rand -base64 32`.

Do not proceed without these, and do not invent a client id — the Google button simply will not render.

- [ ] **Step 3: Verify the whole flow**

Restart `pnpm dev` so Vite picks up the new `VITE_` variable, then:

1. Visit `http://localhost:5173` while signed out. Expected: redirected to `/login`.
2. `curl -s -o /dev/null -w '%{http_code}' localhost:5174/api/habits` → **401**.
3. `curl -s -o /dev/null -w '%{http_code}' localhost:5174/api/health` → **200**.
4. Sign in with the allowed Google account. Expected: land on the dashboard with habits visible.
5. Reload. Expected: still signed in — the cookie survives.
6. Click **Sign out**. Expected: back at `/login`, and step 2's curl still returns 401.

- [ ] **Step 4: Verify the allowlist actually excludes**

This is the requirement the phase exists for, so test it rather than assume it.

Temporarily set `ALLOWED_EMAILS` to an address that is **not** the signing-in account, restart the API, clear the session cookie, and sign in again. Expected: **403** and no session — the app refuses a genuine, Google-verified account that is not on the list. Restore the real value afterwards and confirm sign-in works again.

- [ ] **Step 5: Update the README**

Add to the stack table:

```markdown
| Auth | Google Identity Services + a signed session cookie, one allowed email |
```

Add a section after Getting started:

```markdown
## Signing in

The app is behind a Google sign-in restricted to the addresses in `ALLOWED_EMAILS`.
An empty list admits nobody.

`GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` hold the same value — Vite only exposes
`VITE_`-prefixed variables to the browser, so the login page cannot read the first one.
`SESSION_SECRET` signs the session cookie; generate one with `openssl rand -base64 32`.

The OAuth client needs every origin the app runs on listed as an authorised JavaScript
origin, including `http://localhost:5173` for local development.

Every `/api` route rejects an unauthenticated request; only `/api/health` and `/api/auth/*`
are open. The router guard in the browser is convenience only and protects nothing.
```

- [ ] **Step 6: Final gate and commit**

```bash
pnpm typecheck && npx vitest run && pnpm build
```

```bash
git add .env.example README.md
git commit -m "docs: document Google sign-in configuration

Records why the client id is duplicated under a VITE_ prefix, that an
empty allowlist admits nobody, and that the browser's router guard is
convenience rather than the security boundary."
```

---

## Done when

- `pnpm typecheck`, `npx vitest run` (138 passing) and `pnpm build` all pass, with the suite needing no network.
- An unauthenticated request to any `/api` route except `/api/health` and `/api/auth/*` returns 401.
- Signing in with the allowed Google account works and survives a reload.
- Signing in with a Google account that is **not** on the allowlist is refused with 403 and issues no session.
- Signing out returns you to `/login` and the API refuses you again.
- No secret appears in any log line, commit, or committed file.
