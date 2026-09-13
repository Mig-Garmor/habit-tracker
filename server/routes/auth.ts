import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { isAllowed, parseAllowlist } from '../auth/allowlist'
import {
  readSessionCookie,
  requestIsSecure,
  SESSION_COOKIE_PLAIN,
  SESSION_COOKIE_SECURE,
  sessionCookieName,
  sessionCookieOptions,
} from '../auth/cookie'
import { verifyGoogleIdToken } from '../auth/google'
import { createSessionToken, readSessionToken } from '../auth/session'

export const authRoutes = new Hono()

// Same rule zValidator('json', …) enforces for the data routes (see
// cookie.ts): a mutating route must require this content type, or the CSRF
// rationale that comment states does not hold for it.
const JSON_CONTENT_TYPE = /^application\/json(\s*;.*)?$/i

function hasJsonContentType(c: Context): boolean {
  const contentType = c.req.header('content-type')
  return contentType !== undefined && JSON_CONTENT_TYPE.test(contentType)
}

authRoutes.post('/session', async c => {
  if (!hasJsonContentType(c)) {
    return c.json({ error: 'Content-Type must be application/json' }, 400)
  }

  const secret = process.env.SESSION_SECRET
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!secret || !clientId) {
    console.error('SESSION_SECRET or GOOGLE_CLIENT_ID is not configured')
    return c.json({ error: 'Sign-in is not configured on the server' }, 500)
  }

  const body = await c.req.json<{ credential?: unknown }>().catch(() => ({ credential: undefined }))
  if (typeof body.credential !== 'string') {
    return c.json({ error: 'Missing Google credential' }, 400)
  }

  const email = await verifyGoogleIdToken(body.credential, clientId)
  if (!email) return c.json({ error: 'Could not verify that Google account' }, 401)

  if (!isAllowed(email, parseAllowlist(process.env.ALLOWED_EMAILS))) {
    // Deliberately does not say whether the address exists or the list is empty.
    return c.json({ error: 'That account is not allowed to use this app' }, 403)
  }

  const secure = requestIsSecure(c)
  setCookie(
    c,
    sessionCookieName(secure),
    await createSessionToken(email, secret),
    sessionCookieOptions(secure),
  )
  return c.json({ email })
})

authRoutes.get('/me', async c => {
  const secret = process.env.SESSION_SECRET
  if (!secret) return c.json({ error: 'Not signed in' }, 401)

  const email = await readSessionToken(readSessionCookie(c) ?? '', secret)
  if (!email) return c.json({ error: 'Not signed in' }, 401)

  return c.json({ email })
})

authRoutes.post('/logout', c => {
  if (!hasJsonContentType(c)) {
    return c.json({ error: 'Content-Type must be application/json' }, 400)
  }

  // `__Host-` cookies require Secure on every write, deletions included, or
  // Hono's serializer throws — so this clear always sets it, independent of
  // the current request's own protocol, to guarantee old sessions are wiped.
  deleteCookie(c, SESSION_COOKIE_SECURE, { path: '/', secure: true })
  deleteCookie(c, SESSION_COOKIE_PLAIN, { path: '/' })
  return c.json({ ok: true })
})
