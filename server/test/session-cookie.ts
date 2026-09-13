import { SESSION_COOKIE_PLAIN } from '../auth/cookie'
import { createSessionToken } from '../auth/session'

/** The secret the route tests sign with. Set into the environment by each spec. */
export const TEST_SESSION_SECRET = 'test-session-secret-at-least-32-bytes-long'

/**
 * A Cookie header carrying a real, validly signed session. The existing route
 * tests authenticate rather than bypass the guard, so they keep exercising the
 * thing that actually protects the data. Requests in tests carry no
 * `x-forwarded-proto` and use an http:// URL, so the plain (non-`__Host-`)
 * name is the one the server actually sets — see request.ts / cookie.ts.
 */
export async function signedCookieHeader(email = 'tester@example.com'): Promise<string> {
  return `${SESSION_COOKIE_PLAIN}=${await createSessionToken(email, TEST_SESSION_SECRET)}`
}
