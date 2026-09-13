import { handle } from 'hono/vercel'
import { createApp } from '../server/app'

// One catch-all function for the whole API. `handle` simply forwards the
// incoming Request to the Hono app, so no route needs to know it is running
// on Vercel.
//
// This function must run on the Node runtime, because the Neon driver opens a
// WebSocket pool that Edge cannot (D-14, D-16). Node is Vercel's default and
// the only way off it is opting in to Edge explicitly, so there is nothing to
// declare here — but never add `export const config = { runtime: 'edge' }` to
// this file: it would break every database call at runtime, not at build time.
export default handle(createApp())
