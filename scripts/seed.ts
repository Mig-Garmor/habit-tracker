/**
 * The four habits being tracked. Safe to re-run: it does nothing if any habits
 * already exist, so it never duplicates or overwrites real history.
 */
import 'dotenv/config'
import { db, pool } from '../server/db/client'
import { habits } from '../server/db/schema'
import { today } from '../server/lib/date'

const STARTERS = [
  { name: 'Exercise', kind: 'binary', unit: null, target: null, notesEnabled: true },
  { name: 'Code reading', kind: 'quantity', unit: 'minutes', target: 15, notesEnabled: false },
  { name: 'Meditation', kind: 'quantity', unit: 'minutes', target: 5, notesEnabled: false },
  { name: 'Record one video', kind: 'binary', unit: null, target: null, notesEnabled: false },
] as const

const existing = await db.select().from(habits)

if (existing.length > 0) {
  console.log(`Skipped: ${existing.length} habit(s) already exist.`)
} else {
  const activatedAt = today()
  await db
    .insert(habits)
    .values(STARTERS.map(habit => ({ ...habit, status: 'active' as const, activatedAt })))
  console.log(`Seeded ${STARTERS.length} habits.`)
}

await pool.end()
