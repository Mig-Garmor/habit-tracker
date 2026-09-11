<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app">
    <header class="app__header">
      <RouterLink to="/" class="app__brand">Habit Tracker</RouterLink>
    </header>

    <main class="app__main">
      <RouterView />
    </main>
  </div>
</template>

<style lang="scss" scoped src="./App.scss"></style>
