import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { DB_PATH } from './db/client'
import { habitsRoutes } from './routes/habits'

const app = new Hono()

app.get('/api/health', c => c.json({ ok: true }))
app.route('/api/habits', habitsRoutes)

const port = Number(process.env.PORT ?? 5174)

serve({ fetch: app.fetch, port }, info => {
  console.log(`API listening on http://localhost:${info.port}`)
  console.log(`SQLite at ${DB_PATH}`)
})
