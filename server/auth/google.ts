import { createRemoteJWKSet, jwtVerify } from 'jose'

const GOOGLE_ISSUER = 'https://accounts.google.com'
const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs')

// Created once: the set caches Google's keys and refreshes them on its own.
const jwks = createRemoteJWKSet(GOOGLE_JWKS_URL)

interface GoogleIdTokenClaims {
  email?: unknown
  email_verified?: unknown
}

/**
 * The verified email address from a Google ID token, or null if the token is
 * not one we should trust. Checks the signature against Google's published
 * keys, that the token was issued for THIS client, that Google issued it, that
 * it has not expired, and that Google considers the address verified.
 */
export async function verifyGoogleIdToken(
  credential: string,
  clientId: string,
): Promise<string | null> {
  if (!credential || !clientId) return null

  try {
    const { payload } = await jwtVerify<GoogleIdTokenClaims>(credential, jwks, {
      issuer: GOOGLE_ISSUER,
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
