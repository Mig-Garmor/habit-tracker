import { handle } from 'hono/vercel'
import { createApp } from '../server/app.js'

// One catch-all function for the whole API. `handle` forwards the incoming
// Request to the Hono app, so no route needs to know it is running on Vercel.
//
// The `{ fetch }` wrapper is load-bearing, not decoration. Vercel's Node
// builder decides how to invoke this module by inspecting the default export:
// it is a web handler only if it carries named HTTP-method exports or a
// `fetch` property. A BARE exported function falls through to the next branch
// and is invoked as a Node-style `(req, res)` handler — so `handle(...)` on
// its own would be called with an IncomingMessage instead of a Request, and
// nothing would ever write to the response. Every API call would fail, and
// only in production. `api/index.spec.ts` pins this shape.
//
// This must also run on the Node runtime, because the Neon driver opens a
// WebSocket pool that Edge cannot (D-14, D-16). Node is Vercel's default and
// the only way off it is opting in to Edge explicitly, so there is nothing to
// declare here — but never add `export const config = { runtime: 'edge' }` to
// this file: it would break every database call at runtime, not at build time.
export default { fetch: handle(createApp()) }
