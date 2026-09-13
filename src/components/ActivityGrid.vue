<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardDay, DashboardWeek } from '@/lib/api'

const props = defineProps<{ days: DashboardDay[], unit: string | null, weeks?: DashboardWeek[] }>()

/**
 * Columns of seven, oldest first. The server already starts the range on a
 * Monday, so every column is a whole week.
 */
const dayColumns = computed(() => {
  const chunks: DashboardDay[][] = []
  for (let i = 0; i < props.days.length; i += 7) {
    chunks.push(props.days.slice(i, i + 7))
  }
  return chunks
})

/**
 * `weeks` only carries the last 4 weeks (D-... the server always includes the
 * week containing today), so met-ness is looked up by each column's first
 * date rather than by position — the day columns can span a longer range.
 */
const metStarts = computed(() => new Set(props.weeks?.filter(w => w.met).map(w => w.start) ?? []))

function isMet(column: DashboardDay[]): boolean {
  const start = column[0]?.date
  return start !== undefined && metStarts.value.has(start)
}

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
        <div
          v-for="(column, index) in dayColumns"
          :key="index"
          class="activity-grid__week"
          :class="{ 'activity-grid__week--met': isMet(column) }"
        >
          <RouterLink
            v-for="day in column"
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
