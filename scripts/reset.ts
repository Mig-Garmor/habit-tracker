/**
 * Drops every table and starts over. `pnpm db:reset` chains this with migrate
 * and seed. Destructive by design — it is how a local database is returned to
 * a known state.
 */
import 'dotenv/config'
import { DATABASE_URL, pool } from '../server/db/client'

await pool.query('DROP SCHEMA public CASCADE')
await pool.query('CREATE SCHEMA public')
console.log(`Schema reset on ${new URL(DATABASE_URL).host}`)
await pool.end()
