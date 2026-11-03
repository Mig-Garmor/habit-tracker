import { Hono } from 'hono'
import { databaseStatus } from './db/client.js'
import { requireSession } from './middleware/require-session.js'
import { authRoutes } from './routes/auth.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { habitsRoutes } from './routes/habits.js'
import { habitTools } from './mcp/tools.js'
import { logRoutes } from './routes/log.js'
import { mcpRoutes } from './routes/mcp.js'
import { todayRoutes } from './routes/today.js'

/**
 * Builds the API. Kept separate from index.ts so tests can call app.request()
 * without binding a port.
 */
export function createApp() {
  const app = new Hono()

  // Open: health reveals nothing beyond whether the app can serve, and auth is
  // how a session is obtained.
  //
  // `database` is the result of actually querying, never the connection
  // string. It used to report only whether DATABASE_URL was SET, which meant
  // it said "configured" while the app could not reach its database at all —
  // reassurance that was worse than no check. Presence cannot catch a rotated
  // password or a moved endpoint; a query can.
  app.get('/api/health', async c => {
    const database = await databaseStatus()
    return c.json({ ok: database !== 'unreachable', database }, database === 'unreachable' ? 503 : 200)
  })
  app.route('/api/auth', authRoutes)
  // Its own bearer token, never the session cookie (D-39).
  app.route('/api/mcp', mcpRoutes(habitTools))

  // Everything below this line requires a session.
  app.use('/api/*', requireSession())

  app.route('/api/habits', habitsRoutes)
  app.route('/api/dashboard', dashboardRoutes)
  app.route('/api/log', logRoutes)
  app.route('/api/today', todayRoutes)

  app.onError((err, c) => {
    // Never log the whole error object: a failed Neon connection can carry
    // the connection string (credentials included) in its own properties —
    // the exact hazard databaseHost() exists to avoid. Message and stack only.
    console.error(err.message, err.stack)
    return c.json({ error: 'Something went wrong' }, 500)
  })

  return app
}
