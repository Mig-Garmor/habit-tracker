import { createHash, timingSafeEqual } from 'node:crypto'

/** Shorter than this and a configured token is treated as no token at all (D-39). */
export const MIN_TOKEN_LENGTH = 32

/**
 * Whether an Authorization header carries the MCP token. Compared as SHA-256
 * digests so the constant-time compare always sees equal lengths.
 */
export function bearerOk(header: string | undefined, token: string | undefined): boolean {
  if (!token || token.length < MIN_TOKEN_LENGTH) return false
  const match = /^Bearer (.+)$/.exec(header ?? '')
  if (!match) return false
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(match[1]!), digest(token))
}
