<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { fetchHabitNotes, type HabitNotesResponse } from '@/lib/api'

const route = useRoute()

const data = ref<HabitNotesResponse | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const habitId = computed(() => {
  const raw = route.query.habit
  const id = Number(typeof raw === 'string' ? raw : '')
  return Number.isInteger(id) && id > 0 ? id : null
})

async function load(id: number | null) {
  if (id === null) {
    error.value = 'No habit chosen.'
    loading.value = false
    return
  }

  loading.value = true
  error.value = null
  try {
    data.value = await fetchHabitNotes(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load those notes.'
  } finally {
    loading.value = false
  }
}

/** Notes are written against a day, so the day is the heading. */
function dayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

watch(habitId, load, { immediate: true })
</script>

<template>
  <div class="notes">
    <header class="notes__head">
      <h1 class="notes__title">
        {{ data ? `${data.habit.name} — notes` : 'Notes' }}
      </h1>
      <RouterLink to="/habits" class="notes__back">Back to habits</RouterLink>
    </header>

    <p v-if="error" class="notes__state notes__state--error">{{ error }}</p>
    <p v-else-if="loading" class="notes__state">Loading…</p>

    <!--
      An empty list is the normal state for a habit whose notes were only just
      switched on, so it explains itself rather than looking broken.
    -->
    <p v-else-if="data && data.notes.length === 0" class="notes__state">
      Nothing written yet. Notes you add when logging {{ data.habit.name }} will collect here.
    </p>

    <ol v-else-if="data" class="notes__list">
      <li v-for="entry in data.notes" :key="entry.date" class="notes__item">
        <RouterLink
          :to="{ path: '/log', query: { date: entry.date } }"
          class="notes__date"
        >{{ dayLabel(entry.date) }}</RouterLink>
        <p class="notes__text">{{ entry.note }}</p>
      </li>
    </ol>
  </div>
</template>

<style lang="scss" scoped src="./notes.scss"></style>
