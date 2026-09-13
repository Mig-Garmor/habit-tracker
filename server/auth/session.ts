import { SignJWT, jwtVerify } from 'jose'

/** Thirty days. Long enough not to nag, short enough to bound a stolen laptop. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

const ALGORITHM = 'HS256'

// jose will happily sign and verify HS256 with a handful of bytes; nothing
// about the algorithm itself enforces a safe secret length. A short secret is
// brute-forced offline from one captured cookie, after which every guard in
// the app is decorative — so we enforce it here, the one place both the
// issuing and the verifying path must go through.
const MIN_SECRET_BYTES = 32

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

function isSecretLongEnough(secret: string): boolean {
  return key(secret).byteLength >= MIN_SECRET_BYTES
}

/**
 * Our own session token, not Google's. Stateless by design (D-11): serverless
 * functions share no memory, and a session table would mean a database round
 * trip on every request to a single-user app.
 */
export async function createSessionToken(email: string, secret: string): Promise<string> {
  // Issuing a session signed with a weak secret is worse than failing the
  // sign-in loudly, so this path throws rather than failing closed silently.
  if (!isSecretLongEnough(secret)) {
    throw new Error(`SESSION_SECRET is too short: it must be at least ${MIN_SECRET_BYTES} bytes`)
  }

  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(key(secret))
}

/**
 * The email the token vouches for, or null for anything at all wrong with it —
 * bad signature, tampering, expiry, malformed, or a secret too weak to trust.
 * Callers get one clear answer and cannot accidentally treat a failure as a
 * success. Unlike createSessionToken, this must never throw: a misconfigured
 * deployment should deny everyone, not crash the request.
 */
export async function readSessionToken(token: string, secret: string): Promise<string | null> {
  if (!token) return null
  if (!isSecretLongEnough(secret)) return null
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: [ALGORITHM] })
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null
  } catch {
    return null
  }
}
