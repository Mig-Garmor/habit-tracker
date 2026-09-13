import { handle } from 'hono/vercel'
import { createApp } from '../server/app'

// One catch-all function for the whole API. `handle` simply forwards the
// incoming Request to the Hono app, so no route needs to know it is running
// on Vercel.
export default handle(createApp())

// The Node runtime, not Edge: the Neon driver opens a WebSocket pool, which
// needs a Node environment (D-16).
export const config = {
  runtime: 'nodejs',
}
