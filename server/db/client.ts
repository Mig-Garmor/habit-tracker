import { Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import * as schema from './schema.js'

/**
 * Nothing here connects, reads configuration, or throws at import time.
 *
 * It used to. `DATABASE_URL` was read at module scope and a missing value
 * threw immediately, which on Vercel meant the entrypoint module failed to
 * import and EVERY route died — including `/api/health`, which touches no
 * database. All the caller saw was `FUNCTION_INVOCATION_FAILED`, naming
 * nothing. One missing variable was indistinguishable from a broken build.
 *
 * Now the pool is built on first use. A missing variable fails only the
 * requests that actually need the database, with a message that names it,
 * while the rest of the app keeps answering and says so.
 */

function requireConnectionString(): string {
  const value = process.env.DATABASE_URL
  if (!value) {
    throw new Error(
      'DATABASE_URL is not set. Locally: copy .env.example to .env and paste your Neon ' +
        'connection string. On Vercel: add it to the project’s environment variables ' +
        'for this environment, then redeploy — variables are bound to a deployment when ' +
        'it is created, so an existing deployment will not pick up a new value.',
    )
  }
  return value
}

/** Whether a connection string is present. Never reveals the value. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

let pooled: Pool | undefined

function resolvePool(): Pool {
  if (!pooled) {
    /**
     * Pool over WebSocket rather than the HTTP driver: `neon-http` has no
     * transaction support, and PUT /api/log/:date needs a real one so a partial
     * day cannot commit while the client is told the save failed (D-14).
     */
    pooled = new Pool({ connectionString: requireConnectionString() })

    // Mandatory: pg-pool's idle-client handler (bundled by
    // @neondatabase/serverless) emits 'error' on the pool when an idle
    // connection drops — e.g. a laptop sleeping or Neon restarting a backend.
    // An EventEmitter with no 'error' listener throws instead of emitting,
    // which crashes the whole process.
    pooled.on('error', (error: Error) => {
      console.error('Postgres pool error', error)
    })
  }
  return pooled
}

function createDb() {
  return drizzle(resolvePool(), { schema })
}

let database: ReturnType<typeof createDb> | undefined

function resolveDb(): ReturnType<typeof createDb> {
  if (!database) database = createDb()
  return database
}

/**
 * Defers construction to first property access, so importing this module is
 * free. Methods are bound to the real object: pg-pool and Drizzle both rely on
 * `this`, and an unbound method called through a proxy would lose it.
 */
function lazy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const target = resolve()
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
    has: (_target, property) => Reflect.has(resolve(), property),
  })
}

export const pool: Pool = lazy(resolvePool)
export const db: ReturnType<typeof createDb> = lazy(resolveDb)

/**
 * The host alone, for logging. A malformed URL must never reach an error
 * message: Node's ERR_INVALID_URL carries the whole string — password
 * included — in its `input` property, and tsx prints error properties.
 */
export function databaseHost(): string {
  const value = process.env.DATABASE_URL
  if (!value) return '(DATABASE_URL not set)'
  try {
    return new URL(value).host
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}
