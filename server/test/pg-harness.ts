import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '../db/schema'

/**
 * A real Postgres, compiled to WASM and running in this process. Route tests
 * used to point better-sqlite3 at a temp file; Postgres has no equivalent, and
 * reaching for Neon would make the suite need a network connection.
 *
 * Returns the client alongside the database so callers can close it in
 * afterAll — PGlite's WASM instance is otherwise never released.
 */
export async function createTestDb() {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: './drizzle' })
  return { db, close: () => client.close() }
}
