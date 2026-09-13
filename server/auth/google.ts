import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

// Google documents both forms as valid `iss` values for ID tokens; pinning to
// only one would break sign-in, closed rather than open, the day Google
// happens to emit the other.
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs')

// Created once: the set caches Google's keys and refreshes them on its own.
const remoteJwks = createRemoteJWKSet(GOOGLE_JWKS_URL)

interface GoogleIdTokenClaims {
  email?: unknown
  email_verified?: unknown
}

/**
 * The verified email address from a Google ID token, or null if the token is
 * not one we should trust. Checks the signature against Google's published
 * keys, that the token was issued for THIS client, that Google issued it, that
 * it has not expired, and that Google considers the address verified.
 *
 * `jwks` defaults to Google's real, remote key set — it is only a parameter so
 * tests can inject a local key set they control and avoid the network. The
 * production path never passes it, so it always verifies against Google.
 */
export async function verifyGoogleIdToken(
  credential: string,
  clientId: string,
  jwks: JWTVerifyGetKey = remoteJwks,
): Promise<string | null> {
  if (!credential || !clientId) return null

  try {
    const { payload } = await jwtVerify<GoogleIdTokenClaims>(credential, jwks, {
      issuer: GOOGLE_ISSUERS,
      audience: clientId,
      algorithms: ['RS256'],
    })

    // An unverified address could be anyone's; Google only vouches for verified ones.
    if (payload.email_verified !== true) return null
    return typeof payload.email === 'string' && payload.email.length > 0 ? payload.email : null
  } catch {
    return null
  }
}
