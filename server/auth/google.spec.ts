import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { verifyGoogleIdToken } from './google.js'

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
const GOOGLE_ISSUER = 'https://accounts.google.com'

// A real RS256 key pair and a local JWKS built from its public half, so these
// tests verify actual signature checking without ever reaching the network.
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
let jwks: ReturnType<typeof createLocalJWKSet>

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const publicJwk = await exportJWK(pair.publicKey)
  jwks = createLocalJWKSet({ keys: [publicJwk] })
})

function tokenWith(claims: {
  audience?: string
  issuer?: string
  emailVerified?: boolean
  email?: string
}): Promise<string> {
  const { audience = CLIENT_ID, issuer = GOOGLE_ISSUER, emailVerified = true, email = 'me@example.com' } = claims
  return new SignJWT({ email, email_verified: emailVerified })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey)
}

describe('verifyGoogleIdToken', () => {
  it('accepts a well-formed token signed by the injected key set', async () => {
    const token = await tokenWith({})
    expect(await verifyGoogleIdToken(token, CLIENT_ID, jwks)).toBe('me@example.com')
  })

  it('rejects a token issued for a different audience', async () => {
    const token = await tokenWith({ audience: 'someone-elses-client-id.apps.googleusercontent.com' })
    expect(await verifyGoogleIdToken(token, CLIENT_ID, jwks)).toBeNull()
  })

  it('rejects a token whose email is not verified', async () => {
    const token = await tokenWith({ emailVerified: false })
    expect(await verifyGoogleIdToken(token, CLIENT_ID, jwks)).toBeNull()
  })

  it('accepts the bare accounts.google.com issuer form too', async () => {
    const token = await tokenWith({ issuer: 'accounts.google.com' })
    expect(await verifyGoogleIdToken(token, CLIENT_ID, jwks)).toBe('me@example.com')
  })
})
