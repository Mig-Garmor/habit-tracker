import type { MiddlewareHandler } from 'hono'
import { isAllowed, parseAllowlist } from '../auth/allowlist'
import { readSessionCookie } from '../auth/cookie'
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

    const email = await readSessionToken(readSessionCookie(c) ?? '', secret)
    if (!email) return c.json({ error: 'Not signed in' }, 401)

    // Re-checked on every request, not only at sign-in: this app is
    // single-tenant, so a validly-signed token is total data access, and
    // removing an address from ALLOWED_EMAILS must revoke it immediately
    // rather than waiting up to 30 days for the token to expire (D-10 keeps
    // the allowlist in config, never the database).
    if (!isAllowed(email, parseAllowlist(process.env.ALLOWED_EMAILS))) {
      return c.json({ error: 'Not signed in' }, 401)
    }

    await next()
  }
}
