import { SESSION_COOKIE_PLAIN } from '../auth/cookie.js'
import { createSessionToken } from '../auth/session.js'

/** The secret the route tests sign with. Set into the environment by each spec. */
export const TEST_SESSION_SECRET = 'test-session-secret-at-least-32-bytes-long'

/**
 * The default signed-in address. Route tests that expect a session to work
 * must also put this in `ALLOWED_EMAILS` — `requireSession` re-checks the
 * allowlist on every request, not only at sign-in.
 */
export const TEST_EMAIL = 'tester@example.com'

/**
 * A Cookie header carrying a real, validly signed session. The existing route
 * tests authenticate rather than bypass the guard, so they keep exercising the
 * thing that actually protects the data. Requests in tests carry no
 * `x-forwarded-proto` and use an http:// URL, so the plain (non-`__Host-`)
 * name is the one the server actually sets — see request.ts / cookie.ts.
 */
export async function signedCookieHeader(email = TEST_EMAIL): Promise<string> {
  return `${SESSION_COOKIE_PLAIN}=${await createSessionToken(email, TEST_SESSION_SECRET)}`
}
