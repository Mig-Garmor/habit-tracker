import { mkdir, writeFile } from 'node:fs/promises'
import 'dotenv/config'
import { asc, sql } from 'drizzle-orm'
import { databaseHost, db, pool } from '../server/db/client.js'
import { habitEntries, habits } from '../server/db/schema.js'
import { buildBackup } from '../server/lib/backup.js'

/**
 * Writes every habit and entry to a JSON file under backups/.
 *
 * The hosted database is durable, but Neon's free tier keeps roughly a week of
 * history and free providers do sunset. This is the copy that does not depend
 * on either still being true.
 *
 * Safe to run against production: it only reads.
 */

const BACKUPS = 'backups'

/** How many migrations the database has applied — which schema this dump matches. */
async function schemaVersion(): Promise<number> {
  try {
    const result = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)
    return Number((result.rows[0] as { n: number } | undefined)?.n ?? 0)
  } catch {
    // A database that has never been migrated has no journal table. That is a
    // strange thing to be backing up, but it is not a reason to refuse.
    return 0
  }
}

/** `2026-09-13T14:22:31.000Z` -> `2026-09-13-1422`, which sorts and is filename-safe. */
function stamp(iso: string): string {
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`
}

const exportedAt = new Date().toISOString()

const [habitRows, entryRows, version] = await Promise.all([
  db.select().from(habits).orderBy(asc(habits.id)),
  db.select().from(habitEntries).orderBy(asc(habitEntries.id)),
  schemaVersion(),
])

const backup = buildBackup({
  habits: habitRows,
  entries: entryRows,
  exportedAt,
  host: databaseHost(),
  schemaVersion: version,
})

await mkdir(BACKUPS, { recursive: true })
const path = `${BACKUPS}/habit-tracker-${stamp(exportedAt)}.json`
await writeFile(path, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')

console.log(`Wrote ${path}`)
console.log(`  ${habitRows.length} habit(s), ${entryRows.length} entr(ies)`)
console.log(`  from ${backup.host}, schema version ${version}`)

await pool.end()
