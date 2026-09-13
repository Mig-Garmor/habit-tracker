import { Hono } from 'hono'
import { isDatabaseConfigured } from './db/client'
import { requireSession } from './middleware/require-session'
import { authRoutes } from './routes/auth'
import { dashboardRoutes } from './routes/dashboard'
import { habitsRoutes } from './routes/habits'
import { logRoutes } from './routes/log'

/**
 * Builds the API. Kept separate from index.ts so tests can call app.request()
 * without binding a port.
 */
export function createApp() {
  const app = new Hono()

  // Open: health reveals nothing beyond whether the app is configured, and
  // auth is how a session is obtained.
  //
  // `database` reports only presence, never the value. It exists because a
  // missing DATABASE_URL used to be invisible: every route returned an opaque
  // 500 and the cause could not be told apart from a broken build. One
  // unauthenticated request now distinguishes "app is down" from "app is up
  // but not configured".
  app.get('/api/health', c =>
    c.json({ ok: true, database: isDatabaseConfigured() ? 'configured' : 'not configured' }),
  )
  app.route('/api/auth', authRoutes)

  // Everything below this line requires a session.
  app.use('/api/*', requireSession())

  app.route('/api/habits', habitsRoutes)
  app.route('/api/dashboard', dashboardRoutes)
  app.route('/api/log', logRoutes)

  app.onError((err, c) => {
    // Never log the whole error object: a failed Neon connection can carry
    // the connection string (credentials included) in its own properties —
    // the exact hazard databaseHost() exists to avoid. Message and stack only.
    console.error(err.message, err.stack)
    return c.json({ error: 'Something went wrong' }, 500)
  })

  return app
}
