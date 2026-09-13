import 'dotenv/config'
import { migrate } from 'drizzle-orm/neon-serverless/migrator'
import { databaseHost, db, isDatabaseConfigured, pool } from '../server/db/client.js'

/**
 * Runs pending migrations during a Vercel PRODUCTION build, and only then.
 *
 * This exists because of a real outage. Schema-dependent code was merged and
 * deployed while its migration had not been run, so every query referenced a
 * column that did not exist. `/api/health` stayed green throughout — it checks
 * configuration, not schema — so the app looked half-alive rather than broken.
 *
 * The spec's D-13 originally made migrations human-only, on the grounds that a
 * bad schema change should not ship itself. That is a real risk, and it is
 * traded away deliberately here: for a single-user app, code and schema
 * arriving together is worth more than the chance to apply a migration by hand.
 * What remains of the original protection:
 *
 *   - Only `VERCEL_ENV=production` migrates. Preview builds run on every pull
 *     request; without this guard each one would migrate whatever database its
 *     environment points at.
 *   - A failed migration fails the build, so code whose schema did not apply is
 *     never promoted. That is the whole point — it is not an inconvenience.
 *   - Nothing runs locally. `pnpm db:migrate` stays the local path, so a
 *     developer machine never migrates as a side effect of building.
 */

const environment = process.env.VERCEL_ENV

if (environment !== 'production') {
  console.log(
    environment
      ? `Skipping migrations: VERCEL_ENV is "${environment}", not "production".`
      : 'Skipping migrations: not a Vercel build. Use pnpm db:migrate locally.',
  )
  process.exit(0)
}

if (!isDatabaseConfigured()) {
  console.error(
    'DATABASE_URL is not set for this production build, so migrations cannot run. ' +
      'Add it to the project’s environment variables for Production and redeploy.',
  )
  process.exit(1)
}

await migrate(db, { migrationsFolder: './drizzle' })
console.log(`Migrations applied to ${databaseHost()}`)
await pool.end()
