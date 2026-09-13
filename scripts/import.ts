import { readFile } from 'node:fs/promises'
import 'dotenv/config'
import { databaseHost, db, pool } from '../server/db/client.js'
import { habits } from '../server/db/schema.js'
import { BackupError, parseBackup, restoreBackup } from '../server/lib/backup.js'

/**
 * Restores a backup written by `pnpm db:export`.
 *
 * This is the half that makes the export worth having. A dump nobody can load
 * is a file, not a backup, and the moment you need one is the worst possible
 * moment to be writing a loader against an undocumented shape.
 *
 * Refuses a database that already holds habits unless `--force` is passed,
 * which replaces everything. The default has to be refusal: this command is
 * reached for in a hurry, and pointing it at the wrong database is exactly the
 * mistake someone makes in a hurry.
 */

const [file, ...flags] = process.argv.slice(2)
const force = flags.includes('--force')

if (!file) {
  console.error('Usage: pnpm db:import <file.json> [--force]')
  process.exit(1)
}

let backup
try {
  backup = parseBackup(JSON.parse(await readFile(file, 'utf8')))
} catch (error) {
  if (error instanceof BackupError) {
    console.error(error.message)
  } else if (error instanceof SyntaxError) {
    console.error(`${file} is not valid JSON: ${error.message}`)
  } else {
    console.error(`Could not read ${file}: ${(error as Error).message}`)
  }
  await pool.end()
  process.exit(1)
}

const host = databaseHost()
const existing = await db.select({ id: habits.id }).from(habits)

if (existing.length > 0 && !force) {
  console.error(`Refusing to import: ${host} already holds ${existing.length} habit(s).`)
  console.error('Re-run with --force to replace everything in that database.')
  await pool.end()
  process.exit(1)
}

// restoreBackup owns the delete/insert/sequence-reset sequence, and is tested
// against a real Postgres — see server/lib/backup.restore.spec.ts.
await db.transaction(tx => restoreBackup(tx, backup))

console.log(`Restored ${file} into ${host}`)
console.log(`  ${backup.habits.length} habit(s), ${backup.entries.length} entr(ies)`)
console.log(`  dump taken ${backup.exportedAt} from ${backup.host}, schema version ${backup.schemaVersion}`)
if (existing.length > 0) console.log(`  replaced ${existing.length} habit(s) that were there`)

await pool.end()
