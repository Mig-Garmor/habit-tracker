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
