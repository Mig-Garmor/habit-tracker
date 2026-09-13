import 'dotenv/config'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { DATABASE_URL } from './db/client'

const port = Number(process.env.PORT ?? 5174)

serve({ fetch: createApp().fetch, port }, info => {
  console.log(`API listening on http://localhost:${info.port}`)
  console.log(`Postgres at ${new URL(DATABASE_URL).host}`)
})
