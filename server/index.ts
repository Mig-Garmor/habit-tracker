import { serve } from '@hono/node-server'
import { createApp } from './app'
import { DB_PATH } from './db/client'

const port = Number(process.env.PORT ?? 5174)

serve({ fetch: createApp().fetch, port }, info => {
  console.log(`API listening on http://localhost:${info.port}`)
  console.log(`SQLite at ${DB_PATH}`)
})
