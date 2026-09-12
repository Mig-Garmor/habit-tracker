import { Hono } from 'hono'
import { dashboardRoutes } from './routes/dashboard'
import { habitsRoutes } from './routes/habits'
import { logRoutes } from './routes/log'

/**
 * Builds the API. Kept separate from index.ts so tests can call app.request()
 * without binding a port.
 */
export function createApp() {
  const app = new Hono()

  app.get('/api/health', c => c.json({ ok: true }))
  app.route('/api/habits', habitsRoutes)
  app.route('/api/dashboard', dashboardRoutes)
  app.route('/api/log', logRoutes)

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Something went wrong' }, 500)
  })

  return app
}
