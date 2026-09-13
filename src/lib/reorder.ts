/**
 * The arithmetic behind dragging a row, kept out of the component so it can be
 * tested without a browser. The component owns pointer capture and the DOM;
 * everything here is pure.
 */

/** Moves one item, returning a new array. Out-of-range indices are clamped. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items]
  if (from < 0 || from >= next.length) return next

  const target = Math.max(0, Math.min(to, next.length - 1))
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved as T)
  return next
}

/**
 * Which index a pointer at `clientY` is over, given each row's box.
 *
 * Uses midpoints rather than edges: a row swaps only once the pointer passes
 * its centre, so a drag held near a boundary does not flicker between two
 * positions. Past the last midpoint the answer is the final index, which is
 * what lets a row be dropped at the end of the list.
 */
export function indexForPointer(
  rows: readonly { top: number, height: number }[],
  clientY: number,
): number {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    if (clientY < row.top + row.height / 2) return index
  }
  return Math.max(0, rows.length - 1)
}
