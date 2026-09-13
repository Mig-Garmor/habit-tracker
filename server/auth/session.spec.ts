import { describe, expect, it } from 'vitest'
import { createSessionToken, readSessionToken, SESSION_MAX_AGE_SECONDS } from './session'

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
