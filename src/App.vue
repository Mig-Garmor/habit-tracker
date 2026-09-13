<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import { useAuth } from '@/lib/auth'

const { status, signOut } = useAuth()

async function handleSignOut() {
  await signOut()
  window.location.assign('/login')
}
</script>

<template>
  <div class="app">
    <header class="app__header">
      <nav class="app__nav">
        <RouterLink to="/" class="app__brand">Habit Tracker</RouterLink>
        <!--
          One condition for everything that only means something once signed in,
          so the links and the sign-out button cannot drift apart. `status` is
          'unknown' until /api/auth/me answers, which correctly hides these on
          first paint rather than flashing them at a signed-out visitor.
        -->
        <template v-if="status === 'in'">
          <RouterLink to="/log" class="app__link">Log</RouterLink>
          <RouterLink to="/habits" class="app__link">Habits</RouterLink>
          <button type="button" class="app__signout" @click="handleSignOut">Sign out</button>
        </template>
      </nav>
    </header>

    <main class="app__main">
      <RouterView />
    </main>
  </div>
</template>

<style lang="scss" scoped src="./App.scss"></style>
