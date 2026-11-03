/**
 * Adds the morning work routine (Plan the week, team check-in, recap, what did
 * I do today). Safe to re-run: habits already present by name are left alone.
 * Runs against whatever DATABASE_URL says — never automatically on deploy.
 */
import 'dotenv/config'
import { db, pool } from '../server/db/client.js'
import { today } from '../server/lib/date.js'
import { seedWorkRoutine } from '../server/lib/work-routine.js'

const added = await seedWorkRoutine(db, today())
console.log(added.length ? `Added: ${added.join(', ')}` : 'Skipped: the routine is already there.')

await pool.end()
