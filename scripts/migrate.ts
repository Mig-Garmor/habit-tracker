import 'dotenv/config'
import { migrate } from 'drizzle-orm/neon-serverless/migrator'
import { DATABASE_URL, db, pool } from '../server/db/client'

await migrate(db, { migrationsFolder: './drizzle' })
console.log(`Migrations applied to ${new URL(DATABASE_URL).host}`)
await pool.end()
