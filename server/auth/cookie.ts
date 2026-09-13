import type { CookieOptions } from 'hono/utils/cookie'
import { SESSION_MAX_AGE_SECONDS } from './session'

export const SESSION_COOKIE = 'habit_session'

/**
 * `secure` is derived from the request rather than hardcoded: Safari refuses a
 * Secure cookie over plain http, which would make local development silently
 * fail to keep anyone signed in.
 *
 * SameSite=Lax plus a same-origin API is our CSRF defence — the mutating routes
 * all take `content-type: application/json`, which a browser will not send
 * cross-origin without a preflight the server never grants.
 */
export function sessionCookieOptions(requestUrl: string): CookieOptions {
  return {
    httpOnly: true,
    secure: new URL(requestUrl).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  }
}
