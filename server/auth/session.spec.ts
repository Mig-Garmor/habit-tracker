import { describe, expect, it } from 'vitest'
import { createSessionToken, readSessionToken, SESSION_MAX_AGE_SECONDS } from './session.js'

const SECRET = 'a-test-secret-that-is-at-least-32-bytes-long'
const OTHER_SECRET = 'a-different-secret-also-at-least-32-bytes'

describe('session tokens', () => {
  it('round-trips the email', async () => {
    const token = await createSessionToken('me@example.com', SECRET)
    expect(await readSessionToken(token, SECRET)).toBe('me@example.com')
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken('me@example.com', OTHER_SECRET)
    expect(await readSessionToken(token, SECRET)).toBeNull()
  })

  it('rejects a tampered payload', async () => {
    const token = await createSessionToken('me@example.com', SECRET)
    const [header, , signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: 'attacker@example.com' })).toString('base64url')
    expect(await readSessionToken(`${header}.${forged}.${signature}`, SECRET)).toBeNull()
  })

  it('rejects a token that is not a JWT at all', async () => {
    expect(await readSessionToken('not-a-token', SECRET)).toBeNull()
    expect(await readSessionToken('', SECRET)).toBeNull()
  })

  it('rejects an expired token', async () => {
    // Signed as already expired rather than waiting out a real clock.
    const { SignJWT } = await import('jose')
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('me@example.com')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(SECRET))

    expect(await readSessionToken(expired, SECRET)).toBeNull()
  })

  it('expires in 30 days', () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30)
  })
})

describe('secret length enforcement', () => {
  // Exactly 32 ASCII bytes: the accepted boundary.
  const LONG_ENOUGH_SECRET = 'x'.repeat(32)
  // One byte short of the boundary: must be rejected.
  const TOO_SHORT_SECRET = 'x'.repeat(31)

  it('createSessionToken throws for a too-short secret', async () => {
    await expect(createSessionToken('me@example.com', TOO_SHORT_SECRET)).rejects.toThrow()
  })

  it('readSessionToken returns null for a too-short secret', async () => {
    // Signed with a long-enough secret so only the *read* side is under test.
    const token = await createSessionToken('me@example.com', LONG_ENOUGH_SECRET)
    expect(await readSessionToken(token, TOO_SHORT_SECRET)).toBeNull()
  })

  it('accepts a secret that is exactly 32 bytes', async () => {
    const token = await createSessionToken('me@example.com', LONG_ENOUGH_SECRET)
    expect(await readSessionToken(token, LONG_ENOUGH_SECRET)).toBe('me@example.com')
  })
})
