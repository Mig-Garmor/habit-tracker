import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { isAllowed, parseAllowlist } from '../auth/allowlist'
import { SESSION_COOKIE, sessionCookieOptions } from '../auth/cookie'
import { verifyGoogleIdToken } from '../auth/google'
import { createSessionToken, readSessionToken } from '../auth/session'

export const authRoutes = new Hono()

authRoutes.post('/session', async c => {
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

  setCookie(c, SESSION_COOKIE, await createSessionToken(email, secret), sessionCookieOptions(c.req.url))
  return c.json({ email })
})

authRoutes.get('/me', async c => {
  const secret = process.env.SESSION_SECRET
  if (!secret) return c.json({ error: 'Not signed in' }, 401)

  const email = await readSessionToken(getCookie(c, SESSION_COOKIE) ?? '', secret)
  if (!email) return c.json({ error: 'Not signed in' }, 401)

  return c.json({ email })
})

authRoutes.post('/logout', c => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})
