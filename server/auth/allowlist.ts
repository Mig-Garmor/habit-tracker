/**
 * Who may sign in. Held in configuration rather than the database (D-10): in
 * the database you would need to be signed in to manage the row that lets you
 * sign in, and a bad migration could lock the only user out for good.
 */
export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry.length > 0)
}

/**
 * Fails closed: an empty allowlist admits nobody. Treating "no list" as
 * "anyone" would open the app the moment the variable went missing.
 */
export function isAllowed(email: string, allowlist: string[]): boolean {
  if (!email) return false
  return allowlist.includes(email.trim().toLowerCase())
}
