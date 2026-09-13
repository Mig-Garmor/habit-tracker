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
 * `weeks` now covers the whole rendered range, one summary per column, but
 * met-ness is still looked up by each column's first date rather than by
 * position — cheap insurance against the two ever drifting out of step again.
 */
const metStarts = computed(() => new Set(props.weeks?.filter(w => w.met).map(w => w.start) ?? []))

function isMet(column: DashboardDay[]): boolean {
  const start = column[0]?.date
  return start !== undefined && metStarts.value.has(start)
}

function describe(day: DashboardDay): string {
  const what = !day.completed
    ? 'nothing logged'
    : day.value !== null
      ? `${day.value} ${props.unit ?? ''}`.trim()
      : 'done'
  // A ringed square with no explanation is just a square that looks different.
  // Saying so is what makes the marker mean something on hover.
  return `${day.date} — ${what}${day.note ? ' · has a note' : ''}`
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
            :class="[`is-level-${day.level}`, { 'has-note': Boolean(day.note) }]"
            :title="describe(day)"
            :aria-label="describe(day)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped src="./ActivityGrid.scss"></style>
