import { readFileSync } from 'node:fs'
import { pathToRegexp } from 'path-to-regexp'
import { describe, expect, it } from 'vitest'

/**
 * `vercel.json` rewrite sources are NOT regular expressions. Vercel parses them
 * with path-to-regexp v6.1.0, which is stricter: a capturing group inside a
 * negative lookahead is rejected outright, and the deployment fails to build
 * with `invalid-route-source-pattern` — a failure that appears only on Vercel,
 * never locally. That happened once already, with `/((?!api(/|$)).*)`.
 *
 * These tests compile the real config with the real parser, so an invalid
 * pattern fails here rather than at deploy time.
 */
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  rewrites: { source: string; destination: string }[]
}

/** Resolves a path the way Vercel does: first matching rewrite wins. */
function resolve(path: string): string | null {
  for (const { source, destination } of config.rewrites) {
    if (pathToRegexp(source).test(path)) return destination
  }
  return null
}

describe('vercel.json rewrites', () => {
  it('every source compiles under path-to-regexp, which is what Vercel uses', () => {
    for (const { source } of config.rewrites) {
      expect(() => pathToRegexp(source), `invalid rewrite source: ${source}`).not.toThrow()
    }
  })

  it('sends API paths to the function', () => {
    expect(resolve('/api/habits')).toBe('/api/index')
    expect(resolve('/api/auth/session')).toBe('/api/index')
    expect(resolve('/api/health')).toBe('/api/index')
  })

  it('sends the bare /api path to the function, not the SPA', () => {
    // Without its own rule this falls through to the SPA fallback and answers
    // an API request with HTML.
    expect(resolve('/api')).toBe('/api/index')
  })

  it('sends app routes to the SPA so deep links do not 404', () => {
    expect(resolve('/')).toBe('/index.html')
    expect(resolve('/log')).toBe('/index.html')
    expect(resolve('/habits')).toBe('/index.html')
    expect(resolve('/login')).toBe('/index.html')
  })

  it('does not send anything under /api to the SPA', () => {
    for (const path of ['/api', '/api/', '/api/habits', '/api/auth/logout']) {
      expect(resolve(path), `${path} must not fall through to the SPA`).not.toBe('/index.html')
    }
  })
})
