/**
 * Drops every table and starts over. `pnpm db:reset` chains this with migrate
 * and seed. Destructive by design — it is how a local database is returned to
 * a known state.
 */
import 'dotenv/config'
import { databaseHost, pool } from '../server/db/client.js'

// Drizzle's Postgres migrator keeps its applied-migrations journal in its own
// `drizzle` schema (migrationsSchema defaults to "drizzle", and this project
// never overrides it) — separate from `public`, where the app's tables live.
// Dropping only `public` leaves that journal in place, so the next db:migrate
// sees migration 0000 already recorded and silently does nothing, leaving the
// database empty and un-migratable. Both drops use IF EXISTS so this also
// works against a database that has never been migrated.
await pool.query('DROP SCHEMA IF EXISTS public CASCADE')
await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
await pool.query('CREATE SCHEMA public')
console.log(`Schema reset on ${databaseHost()}`)
await pool.end()
