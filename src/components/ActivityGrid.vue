<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardDay } from '@/lib/api'

const props = defineProps<{ days: DashboardDay[], unit: string | null }>()

/**
 * Columns of seven, oldest first. The server already starts the range on a
 * Monday, so every column is a whole week.
 */
const weeks = computed(() => {
  const chunks: DashboardDay[][] = []
  for (let i = 0; i < props.days.length; i += 7) {
    chunks.push(props.days.slice(i, i + 7))
  }
  return chunks
})

function describe(day: DashboardDay): string {
  if (!day.completed) return `${day.date} — nothing logged`
  if (day.value !== null) return `${day.date} — ${day.value} ${props.unit ?? ''}`.trim()
  return `${day.date} — done`
}
</script>

<template>
  <div class="activity-grid">
    <div class="activity-grid__scroll">
      <div class="activity-grid__weeks">
        <div v-for="(week, index) in weeks" :key="index" class="activity-grid__week">
          <RouterLink
            v-for="day in week"
            :key="day.date"
            :to="{ path: '/log', query: { date: day.date } }"
            class="activity-grid__day"
            :class="`is-level-${day.level}`"
            :title="describe(day)"
            :aria-label="describe(day)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped src="./ActivityGrid.scss"></style>
