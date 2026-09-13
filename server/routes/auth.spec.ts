import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { signedCookieHeader, TEST_SESSION_SECRET } from '../test/session-cookie'
import { createTestDb } from '../test/pg-harness'

const holder = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock('../db/client', () => ({
  get db() {
    return holder.db
  },
}))

// Wraps the real implementation by default, so every existing test still
// exercises real JWKS/issuer/audience logic. Only the 403-allowlist test below
// overrides it for a single call, to reach that branch without a real Google
// token.
vi.mock('../auth/google', async importOriginal => {
  const actual = await importOriginal<typeof import('../auth/google')>()
  return { ...actual, verifyGoogleIdToken: vi.fn(actual.verifyGoogleIdToken) }
})

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

  it('accepts a session under the __Host- name', async () => {
    const { createSessionToken } = await import('../auth/session')
    const token = await createSessionToken('me@example.com', TEST_SESSION_SECRET)
    const response = await app.request('/api/habits', {
      headers: { cookie: `__Host-habit_session=${token}` },
    })
    expect(response.status).toBe(200)
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

  it('rejects a non-JSON content type', async () => {
    // The CSRF defence in cookie.ts rests on this: a cross-origin request can
    // send text/plain without a preflight, so the route must not parse it.
    const response = await app.request('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ credential: 'irrelevant' }),
    })
    expect(response.status).toBe(400)
  })

  it('returns 403 for a Google-verified account outside the allowlist', async () => {
    const { verifyGoogleIdToken } = await import('../auth/google')
    vi.mocked(verifyGoogleIdToken).mockResolvedValueOnce('not-on-the-list@example.com')

    const response = await post({ credential: 'irrelevant' })
    expect(response.status).toBe(403)
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
    const response = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    expect(response.status).toBe(200)
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('habit_session=')
    expect(setCookie).toMatch(/Max-Age=0|Expires=/i)
  })

  it('rejects a non-JSON content type', async () => {
    const response = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
    })
    expect(response.status).toBe(400)
  })
})
