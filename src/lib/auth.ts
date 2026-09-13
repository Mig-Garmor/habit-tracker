import { ref } from 'vue'

export type AuthStatus = 'unknown' | 'in' | 'out'

// Module-level so every component and the router guard share one answer
// rather than each asking the server again.
const email = ref<string | null>(null)
const status = ref<AuthStatus>('unknown')

async function loadSession(): Promise<AuthStatus> {
  try {
    const response = await fetch('/api/auth/me')
    if (response.ok) {
      const body = (await response.json()) as { email: string }
      email.value = body.email
      status.value = 'in'
    } else {
      email.value = null
      status.value = 'out'
    }
  } catch {
    // The API being unreachable is not the same as being signed out, but the
    // only safe assumption for a guard is that we are not signed in.
    email.value = null
    status.value = 'out'
  }
  return status.value
}

/** Exchanges a Google credential for a session cookie. Throws with the server's message. */
async function signIn(credential: string): Promise<void> {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential }),
  })

  if (!response.ok) {
    const message = await response
      .json()
      .then((body: { error?: unknown }) => (typeof body.error === 'string' ? body.error : null))
      .catch(() => null)
    throw new Error(message ?? 'Could not sign in')
  }

  const body = (await response.json()) as { email: string }
  email.value = body.email
  status.value = 'in'
}

async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
  email.value = null
  status.value = 'out'
}

/** Marks the session stale without a request — used when the API returns 401. */
function clearSession(): void {
  email.value = null
  status.value = 'out'
}

export function useAuth() {
  return { email, status, loadSession, signIn, signOut, clearSession }
}
