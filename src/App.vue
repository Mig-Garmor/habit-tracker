<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app">
    <header class="app__header">
      <nav class="app__nav">
        <RouterLink to="/" class="app__brand">Habit Tracker</RouterLink>
        <RouterLink to="/log" class="app__link">Log</RouterLink>
        <RouterLink to="/habits" class="app__link">Habits</RouterLink>
      </nav>
    </header>

    <main class="app__main">
      <RouterView />
    </main>
  </div>
</template>

<style lang="scss" scoped src="./App.scss"></style>
