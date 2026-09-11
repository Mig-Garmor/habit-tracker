import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { DB_PATH, db, sqlite } from '../server/db/client'

migrate(db, { migrationsFolder: './drizzle' })
console.log(`Migrations applied to ${DB_PATH}`)
sqlite.close()
