/**
 * Puts three starter habits in the database so a fresh clone has something to
 * show. Safe to re-run: it does nothing if any habits already exist.
 */
import { db, sqlite } from '../server/db/client'
import { habits } from '../server/db/schema'

const STARTERS = ['Drink water', 'Read 20 minutes', 'Walk outside']

const existing = db.select().from(habits).all()

if (existing.length > 0) {
  console.log(`Skipped: ${existing.length} habit(s) already exist.`)
} else {
  db.insert(habits)
    .values(STARTERS.map(name => ({ name })))
    .run()
  console.log(`Seeded ${STARTERS.length} habits.`)
}

sqlite.close()
