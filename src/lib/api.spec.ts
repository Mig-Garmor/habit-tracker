import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDashboard, fetchHabits } from './api'

/** Stand in for the browser's fetch so each case can pick its own failure. */
function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('when the API cannot be reached', () => {
  // The app runs as two processes: Vite on 5173 proxies /api to the Hono
  // server on 5174. If that server is not running the proxy answers 5xx, and
  // if nothing is listening at all fetch rejects outright. Both mean the same
  // thing to the user, and a bare status code does not tell them what to do.

  it.each([502, 503, 504])('explains a %i from the proxy', async status => {
    stubFetch(async () => jsonResponse({}, status))
    await expect(fetchDashboard()).rejects.toThrow(/reach the API/i)
  })

  it('names the command that starts it', async () => {
    stubFetch(async () => jsonResponse({}, 502))
    await expect(fetchDashboard()).rejects.toThrow(/pnpm dev/)
  })

  it('explains a rejected fetch the same way', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(fetchDashboard()).rejects.toThrow(/reach the API/i)
  })

  it('does not leak the raw status code as the whole message', async () => {
    stubFetch(async () => jsonResponse({}, 502))
    await expect(fetchDashboard()).rejects.not.toThrow(/^Request failed with status 502$/)
  })
})

describe('when the API answers with an error', () => {
  it('surfaces a string error from the server', async () => {
    stubFetch(async () => jsonResponse({ error: 'Habit not found' }, 404))
    await expect(fetchHabits()).rejects.toThrow('Habit not found')
  })

  it('never renders a structured error as [object Object]', async () => {
    // @hono/zod-validator returns { error: <ZodError> } — an object.
    stubFetch(async () => jsonResponse({ error: { name: 'ZodError', issues: [] } }, 400))
    await expect(fetchHabits()).rejects.toThrow('Request failed with status 400')
  })

  it('falls back when the body is not JSON at all', async () => {
    stubFetch(async () => new Response('<html>nope</html>', { status: 500 }))
    await expect(fetchHabits()).rejects.toThrow('Request failed with status 500')
  })
})

describe('when the API answers normally', () => {
  it('returns the parsed body', async () => {
    stubFetch(async () => jsonResponse({ habits: [{ id: 1, name: 'Exercise' }] }, 200))
    await expect(fetchHabits()).resolves.toEqual([{ id: 1, name: 'Exercise' }])
  })
})
