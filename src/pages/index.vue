<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import HabitItem from '@/components/HabitItem.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchToday, toggleHabit, type TodayHabit } from '@/lib/api'

const habits = ref<TodayHabit[]>([])
const date = ref('')
const loading = ref(true)
const error = ref<string | null>(null)
const pendingId = ref<number | null>(null)

const doneCount = computed(() => habits.value.filter(h => h.completed).length)

const prettyDate = computed(() => {
  if (!date.value) return ''
  const [year, month, day] = date.value.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
})

async function load() {
  loading.value = true
  error.value = null
  try {
    const data = await fetchToday()
    habits.value = data.habits
    date.value = data.date
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not reach the API.'
  } finally {
    loading.value = false
  }
}

async function onToggle(id: number) {
  pendingId.value = id
  try {
    const result = await toggleHabit(id)
    const habit = habits.value.find(h => h.id === id)
    if (habit) habit.completed = result.completed
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save that change.'
  } finally {
    pendingId.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="home">
    <Card class="home__card">
      <CardHeader>
        <CardTitle>Today</CardTitle>
        <CardDescription>{{ prettyDate || 'Loading…' }}</CardDescription>
      </CardHeader>

      <CardContent>
        <p v-if="loading" class="home__state">Loading your habits…</p>

        <div v-else-if="error" class="home__state home__state--error">
          <p>{{ error }}</p>
          <Button variant="outline" size="sm" @click="load">Try again</Button>
        </div>

        <p v-else-if="habits.length === 0" class="home__state">
          No habits yet. Run <code>pnpm db:seed</code> to add a few starters.
        </p>

        <template v-else>
          <p class="home__progress">{{ doneCount }} of {{ habits.length }} done</p>
          <ul class="home__list">
            <HabitItem
              v-for="habit in habits"
              :key="habit.id"
              :habit="habit"
              :pending="pendingId === habit.id"
              @toggle="onToggle"
            />
          </ul>
        </template>
      </CardContent>
    </Card>
  </div>
</template>

<style lang="scss" scoped src="./index.scss"></style>
