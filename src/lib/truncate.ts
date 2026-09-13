/** The longest a habit name may be before it is shortened for display. */
export const NAME_LIMIT = 12

/**
 * Shortens a name to at most `limit` characters, ellipsis included.
 *
 * The ellipsis counts toward the limit rather than being added on top, so
 * "no more than 12 characters" means exactly that and every row is the same
 * width. A trailing space before the ellipsis is dropped, because "Record …"
 * reads as a mistake where "Record…" reads as a cut.
 *
 * Only the display is shortened. The stored name is never touched, and the
 * full name stays available as a title attribute.
 */
export function truncateName(name: string, limit: number = NAME_LIMIT): string {
  if (name.length <= limit) return name
  return `${name.slice(0, limit - 1).trimEnd()}…`
}

/** Whether a name is being shown shortened, so a tooltip is worth offering. */
export function isTruncated(name: string, limit: number = NAME_LIMIT): boolean {
  return name.length > limit
}
