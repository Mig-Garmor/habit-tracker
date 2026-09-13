import 'dotenv/config'
import { migrate } from 'drizzle-orm/neon-serverless/migrator'
import { databaseHost, db, pool } from '../server/db/client.js'

await migrate(db, { migrationsFolder: './drizzle' })
console.log(`Migrations applied to ${databaseHost()}`)
await pool.end()
