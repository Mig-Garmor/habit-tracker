import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * These tests exist because of a real production failure.
 *
 * `DATABASE_URL` used to be read at module scope, and a missing value threw
 * during import. On Vercel that meant the entrypoint module never loaded, so
 * every route — including `/api/health`, which touches no database — returned
 * an opaque `FUNCTION_INVOCATION_FAILED`. A single missing environment
 * variable was indistinguishable from a broken build, and took several
 * deploy cycles to identify.
 *
 * The contract now: importing is free, and the failure is specific and named.
 */

const ORIGINAL = process.env.DATABASE_URL

beforeEach(() => {
  // The module memoises the pool it builds, so each test needs a fresh copy.
  vi.resetModules()
  delete process.env.DATABASE_URL
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = ORIGINAL
})

async function freshClient() {
  return import('./client.js')
}

describe('the database client', () => {
  it('imports without throwing when DATABASE_URL is absent', async () => {
    // The regression that took down every route. Importing must be free.
    await expect(freshClient()).resolves.toBeDefined()
  })

  it('reports that the database is not configured rather than crashing', async () => {
    const { isDatabaseConfigured } = await freshClient()
    expect(isDatabaseConfigured()).toBe(false)
  })

  it('reports configured once DATABASE_URL is present', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pw@ep-test.neon.tech/db'
    const { isDatabaseConfigured } = await freshClient()
    expect(isDatabaseConfigured()).toBe(true)
  })

  it('throws a message naming DATABASE_URL when the database is actually used', async () => {
    const { db } = await freshClient()
    // The failure must arrive here — at use — not at import.
    expect(() => db.select()).toThrow(/DATABASE_URL is not set/)
  })

  it('tells you a deployment must be redeployed to pick up a new variable', async () => {
    // The part that cost the most time: the dashboard showed the variable set
    // while the running deployment still had the old environment.
    const { db } = await freshClient()
    expect(() => db.select()).toThrow(/redeploy/i)
  })

  describe('databaseHost', () => {
    it('does not throw when DATABASE_URL is absent', async () => {
      const { databaseHost } = await freshClient()
      expect(databaseHost()).toBe('(DATABASE_URL not set)')
    })

    it('returns only the host, never the password', async () => {
      process.env.DATABASE_URL = 'postgresql://user:hunter2@ep-test.neon.tech/db?sslmode=require'
      const { databaseHost } = await freshClient()
      const host = databaseHost()
      expect(host).toBe('ep-test.neon.tech')
      expect(host).not.toContain('hunter2')
    })

    it('does not leak the string when it is unparseable', async () => {
      process.env.DATABASE_URL = 'not a url, but it does contain hunter2'
      const { databaseHost } = await freshClient()
      const host = databaseHost()
      expect(host).toBe('(unparseable DATABASE_URL)')
      expect(host).not.toContain('hunter2')
    })
  })
})
