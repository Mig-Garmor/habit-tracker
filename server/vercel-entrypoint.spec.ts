import { beforeAll, describe, expect, it, vi } from 'vitest'

// This lives in server/ rather than next to the file it tests, because Vercel
// builds EVERY file under api/ as a serverless function. A spec there is
// compiled as a function, fails on vitest and node types it has no reason to
// have, and breaks the deployment. api/ holds functions and nothing else.

// The entrypoint builds a real app at import time, which reaches the database
// client. The shape of the export is what matters here, not any query, so the
// client is replaced rather than a test database being stood up.
vi.mock('./db/client', () => ({
  db: {},
  isDatabaseConfigured: () => true,
  databaseStatus: () => Promise.resolve('reachable'),
}))

let entrypoint: { fetch: (request: Request) => Response | Promise<Response> }

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-session-secret-at-least-32-bytes-long'
  process.env.ALLOWED_EMAILS = 'tester@example.com'
  entrypoint = (await import('../api/index.js')).default
})

/**
 * These tests exist because of how Vercel's Node builder chooses to invoke a
 * function. From `@vercel/node`'s bundling-handler:
 *
 *   const isWebHandler =
 *     HTTP_METHODS.some(m => typeof listener[m] === 'function') ||
 *     typeof listener.fetch === 'function'
 *   if (isWebHandler) return createWebHandler(listener)
 *   if (typeof listener === 'function') return listener   // <- (req, res)
 *
 * A bare exported function therefore gets called with a Node IncomingMessage
 * and a ServerResponse. Hono expects a web Request and writes nothing to a
 * ServerResponse, so the whole API would fail — in production only, since
 * nothing local invokes the module this way. A unit test cannot run Vercel's
 * builder, but it can pin the one property the builder branches on.
 */
describe('the Vercel entrypoint', () => {
  it('exports an object carrying a fetch function, which is what marks it a web handler', () => {
    expect(typeof entrypoint).toBe('object')
    expect(typeof entrypoint.fetch).toBe('function')
  })

  it('is not a bare function, which Vercel would invoke as a Node (req, res) handler', () => {
    expect(typeof entrypoint).not.toBe('function')
  })

  it('answers a web Request with a web Response', async () => {
    const response = await entrypoint.fetch(new Request('https://example.com/api/health'))
    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, database: 'reachable' })
  })

  it('survives its fetch being called unbound, as the builder calls it', async () => {
    // createWebHandler does `methods[m] = listener.fetch` and later `fn(request)`,
    // so `this` is lost. Hono's fetch is a bound class field; this pins that.
    const { fetch: unbound } = entrypoint
    const response = await unbound(new Request('https://example.com/api/health'))
    expect(response.status).toBe(200)
  })
})
