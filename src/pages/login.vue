<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/lib/auth'

interface GoogleCredentialResponse { credential?: string }

interface GoogleAccountsId {
  initialize: (config: { client_id: string, callback: (r: GoogleCredentialResponse) => void }) => void
  renderButton: (el: HTMLElement, options: Record<string, string>) => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

const router = useRouter()
const { signIn } = useAuth()

const buttonHost = ref<HTMLElement | null>(null)
const error = ref<string | null>(null)

async function handleCredential(response: GoogleCredentialResponse) {
  error.value = null
  if (!response.credential) {
    error.value = 'Google did not return a credential.'
    return
  }
  try {
    await signIn(response.credential)
    await router.replace('/')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not sign in.'
  }
}

let timer: number | undefined
// ~5 seconds at 50ms. Long enough for a slow network, short enough that a
// blocked script reports itself instead of hanging silently.
const MAX_ATTEMPTS = 100

onMounted(() => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) {
    error.value = 'VITE_GOOGLE_CLIENT_ID is not set. Add it to .env and restart the dev server.'
    return
  }
  // The GSI script is loaded async in index.html, so it may not be ready yet.
  let attempts = 0
  const start = () => {
    if (!window.google || !buttonHost.value) {
      attempts += 1
      if (attempts > MAX_ATTEMPTS) {
        error.value = 'Could not load Google sign-in. Check your connection or any blocking extension, then reload.'
        return
      }
      timer = window.setTimeout(start, 50)
      return
    }
    window.google.accounts.id.initialize({ client_id: clientId, callback: handleCredential })
    window.google.accounts.id.renderButton(buttonHost.value, { theme: 'outline', size: 'large' })
  }
  start()
})

onUnmounted(() => {
  if (timer !== undefined) window.clearTimeout(timer)
})
</script>

<template>
  <div class="login">
    <h1 class="login__title">Habit Tracker</h1>
    <p class="login__lead">Sign in to continue.</p>
    <div ref="buttonHost" class="login__button"></div>
    <p v-if="error" class="login__error">{{ error }}</p>
  </div>
</template>

<style lang="scss" scoped src="./login.scss"></style>
