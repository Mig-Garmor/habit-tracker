import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { SESSION_COOKIE } from '../auth/cookie'
import { readSessionToken } from '../auth/session'

/**
 * The actual security boundary. The client's router guard only stops the UI
 * flashing; this is what protects the data.
 */
export function requireSession(): MiddlewareHandler {
  return async (c, next) => {
    const secret = process.env.SESSION_SECRET
    // A missing secret must not mean "let everyone in".
    if (!secret) return c.json({ error: 'Not signed in' }, 401)

    const email = await readSessionToken(getCookie(c, SESSION_COOKIE) ?? '', secret)
    if (!email) return c.json({ error: 'Not signed in' }, 401)

    await next()
  }
}
