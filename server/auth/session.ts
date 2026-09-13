import { SignJWT, jwtVerify } from 'jose'

/** Thirty days. Long enough not to nag, short enough to bound a stolen laptop. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

const ALGORITHM = 'HS256'

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

/**
 * Our own session token, not Google's. Stateless by design (D-11): serverless
 * functions share no memory, and a session table would mean a database round
 * trip on every request to a single-user app.
 */
export async function createSessionToken(email: string, secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(key(secret))
}

/**
 * The email the token vouches for, or null for anything at all wrong with it —
 * bad signature, tampering, expiry, malformed. Callers get one clear answer and
 * cannot accidentally treat a failure as a success.
 */
export async function readSessionToken(token: string, secret: string): Promise<string | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: [ALGORITHM] })
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null
  } catch {
    return null
  }
}
