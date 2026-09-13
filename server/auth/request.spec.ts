import { describe, expect, it } from 'vitest'
import { isSecureRequest } from './request'

describe('isSecureRequest', () => {
  // Behind Vercel the function sees plain http; x-forwarded-proto is the truth.
  it('trusts x-forwarded-proto over the request URL', () => {
    expect(isSecureRequest('https', 'http://internal.local/api/habits')).toBe(true)
  })

  it('reports insecure when the proxy says http', () => {
    expect(isSecureRequest('http', 'http://internal.local/api/habits')).toBe(false)
  })

  // Proxy chains append, so the client-facing protocol is the FIRST entry.
  it('takes the first entry of a comma-separated chain', () => {
    expect(isSecureRequest('https,http', 'http://internal.local/x')).toBe(true)
    expect(isSecureRequest('http,https', 'http://internal.local/x')).toBe(false)
  })

  it('tolerates whitespace in the chain', () => {
    expect(isSecureRequest(' https , http ', 'http://internal.local/x')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isSecureRequest('HTTPS', 'http://internal.local/x')).toBe(true)
  })

  // No proxy header: local development, where the URL is the truth.
  it('falls back to the request URL when the header is absent', () => {
    expect(isSecureRequest(undefined, 'https://example.com/x')).toBe(true)
    expect(isSecureRequest(undefined, 'http://localhost:5173/x')).toBe(false)
  })

  it('falls back when the header is empty', () => {
    expect(isSecureRequest('', 'https://example.com/x')).toBe(true)
    expect(isSecureRequest('   ', 'http://localhost:5173/x')).toBe(false)
  })

  // A malformed URL must not throw and must not claim to be secure.
  it('reports insecure rather than throwing on a malformed URL', () => {
    expect(isSecureRequest(undefined, 'not a url')).toBe(false)
  })
})
