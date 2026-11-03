import { describe, expect, it } from 'vitest'
import { bearerOk } from './auth.js'

const TOKEN = 'x'.repeat(40)

describe('bearerOk (D-39)', () => {
  it('accepts the configured token', () => {
    expect(bearerOk(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
  })

  it('refuses a wrong or missing token', () => {
    expect(bearerOk(`Bearer ${'y'.repeat(40)}`, TOKEN)).toBe(false)
    expect(bearerOk(undefined, TOKEN)).toBe(false)
    expect(bearerOk(TOKEN, TOKEN)).toBe(false)
  })

  it('stays shut when no token is configured, or one too short to be safe', () => {
    expect(bearerOk('Bearer ', undefined)).toBe(false)
    expect(bearerOk('Bearer short', 'short')).toBe(false)
  })
})
