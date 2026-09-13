import { describe, expect, it } from 'vitest'
import { isAllowed, parseAllowlist } from './allowlist'

describe('parseAllowlist', () => {
  it('splits a comma-separated list', () => {
    expect(parseAllowlist('a@example.com,b@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })

  it('trims whitespace around entries', () => {
    expect(parseAllowlist(' a@example.com , b@example.com ')).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })

  it('lowercases entries so matching is case-insensitive', () => {
    expect(parseAllowlist('Me@Example.COM')).toEqual(['me@example.com'])
  })

  it('drops empty entries from stray commas', () => {
    expect(parseAllowlist('a@example.com,,')).toEqual(['a@example.com'])
  })

  it('is empty for undefined or blank', () => {
    expect(parseAllowlist(undefined)).toEqual([])
    expect(parseAllowlist('   ')).toEqual([])
  })
})

describe('isAllowed', () => {
  const allowlist = ['me@example.com']

  it('accepts an exact match', () => {
    expect(isAllowed('me@example.com', allowlist)).toBe(true)
  })

  it('accepts a differently-cased address', () => {
    expect(isAllowed('Me@Example.com', allowlist)).toBe(true)
  })

  it('rejects anyone else', () => {
    expect(isAllowed('someone@example.com', allowlist)).toBe(false)
  })

  // An empty allowlist must lock everyone out. The opposite — treating "no
  // list" as "anyone" — would silently open the app the moment the variable
  // went missing in production.
  it('rejects everyone when the allowlist is empty', () => {
    expect(isAllowed('me@example.com', [])).toBe(false)
  })

  it('rejects an empty address', () => {
    expect(isAllowed('', allowlist)).toBe(false)
  })
})
