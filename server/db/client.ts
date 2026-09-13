import { Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and paste your Neon connection string.',
  )
}

export const DATABASE_URL = connectionString

/**
 * Pool over WebSocket rather than the HTTP driver: `neon-http` has no
 * transaction support, and PUT /api/log/:date needs a real one so a partial
 * day cannot commit while the client is told the save failed (D-14).
 */
export const pool = new Pool({ connectionString })

// Mandatory: pg-pool's idle-client handler (bundled by @neondatabase/serverless)
// emits 'error' on the pool when an idle connection drops — e.g. a laptop
// sleeping or Neon restarting a backend. An EventEmitter with no 'error'
// listener throws instead of emitting, which crashes the whole process.
pool.on('error', (error: Error) => {
  console.error('Postgres pool error', error)
})

export const db = drizzle(pool, { schema })

/**
 * The host alone, for logging. A malformed URL must never reach an error
 * message: Node's ERR_INVALID_URL carries the whole string — password
 * included — in its `input` property, and tsx prints error properties.
 */
export function databaseHost(): string {
  try {
    return new URL(DATABASE_URL).host
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}
