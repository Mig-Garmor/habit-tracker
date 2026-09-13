/**
 * Did this request reach the user over HTTPS?
 *
 * Vercel terminates TLS at its edge, so the function behind it sees a plain
 * `http:` request even when the browser used HTTPS. Deriving security from the
 * request URL alone would silently drop `Secure` from the session cookie in
 * production — the one place it matters most (D-15).
 */
export function isSecureRequest(
  forwardedProto: string | undefined,
  requestUrl: string,
): boolean {
  const forwarded = forwardedProto?.trim()
  if (forwarded) {
    // Proxy chains append to this header; the client-facing hop is first.
    const [clientFacing] = forwarded.split(',')
    return clientFacing!.trim().toLowerCase() === 'https'
  }

  try {
    return new URL(requestUrl).protocol === 'https:'
  } catch {
    // A URL we cannot parse is not one we will call secure.
    return false
  }
}
