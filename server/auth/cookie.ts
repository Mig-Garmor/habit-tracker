import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type { CookieOptions } from 'hono/utils/cookie'
import { isSecureRequest } from './request.js'
import { SESSION_MAX_AGE_SECONDS } from './session.js'

/**
 * The `__Host-` prefix requires Secure, Path=/ and no Domain, and in exchange
 * stops a sibling deployment on the same apex (*.vercel.app) from planting a
 * cookie of this name. Browsers REJECT a `__Host-` cookie without Secure, so
 * local http development has to use the plain name or sign-in silently fails.
 */
export const SESSION_COOKIE_SECURE = '__Host-habit_session'
export const SESSION_COOKIE_PLAIN = 'habit_session'

export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_PLAIN
}

/** Whether this request reached the user over HTTPS (D-15). */
export function requestIsSecure(c: Context): boolean {
  return isSecureRequest(c.req.header('x-forwarded-proto'), c.req.url)
}

/**
 * SameSite=Lax plus a same-origin API is the CSRF defence: every mutating
 * route requires `content-type: application/json`, which a browser will not
 * send cross-origin without a preflight the server never grants.
 */
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  }
}

/**
 * Reads whichever name this deployment uses. Checking both means a session
 * issued before a protocol change is still honoured rather than silently
 * logging the user out.
 */
export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_SECURE) ?? getCookie(c, SESSION_COOKIE_PLAIN)
}
