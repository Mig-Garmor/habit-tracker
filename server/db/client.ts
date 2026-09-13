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

export const db = drizzle(pool, { schema })
