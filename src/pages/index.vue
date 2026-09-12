<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ActivityGrid from '@/components/ActivityGrid.vue'
import HealthPill from '@/components/HealthPill.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchDashboard, updateHabit, type DashboardResponse } from '@/lib/api'

const data = ref<DashboardResponse | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const parkingId = ref<number | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    data.value = await fetchDashboard()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not reach the API.'
  } finally {
    loading.value = false
  }
}

async function park(habitId: number) {
  parkingId.value = habitId
  try {
    await updateHabit(habitId, { status: 'upcoming' })
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not move that habit.'
  } finally {
    parkingId.value = null
  }
}

function streakLabel(streak: number) {
  return streak === 1 ? '1 day streak' : `${streak} day streak`
}

onMounted(load)
</script>

<template>
  <div class="dashboard">
    <p v-if="loading" class="dashboard__state">Loading…</p>

    <div v-else-if="error" class="dashboard__state dashboard__state--error">
      <p>{{ error }}</p>
      <Button variant="outline" size="sm" @click="load">Try again</Button>
    </div>

    <template v-else-if="data">
      <section v-if="data.warnings.length" class="dashboard__warnings">
        <h2 class="dashboard__warnings-title">Slipping</h2>
        <p class="dashboard__warnings-lead">
          These aren't sticking. Park them until the rest are consistent.
        </p>
        <ul class="dashboard__warnings-list">
          <li v-for="warning in data.warnings" :key="warning.habitId" class="dashboard__warning">
            <span class="dashboard__warning-name">{{ warning.name }}</span>
            <span class="dashboard__warning-rate">{{ Math.round(warning.rate * 100) }}% of the last 14 days</span>
            <Button
              variant="outline"
              size="sm"
              :disabled="parkingId === warning.habitId"
              @click="park(warning.habitId)"
            >
              Move to upcoming
            </Button>
          </li>
        </ul>
      </section>

      <p v-if="data.habits.length === 0" class="dashboard__state">
        No active habits. Add one on the Habits screen.
      </p>

      <Card v-for="habit in data.habits" :key="habit.id" class="dashboard__habit">
        <CardHeader class="dashboard__habit-header">
          <CardTitle>{{ habit.name }}</CardTitle>
          <HealthPill :health="habit.health" :rate="habit.rate" />
        </CardHeader>
        <CardContent>
          <p class="dashboard__habit-meta">
            {{ streakLabel(habit.streak) }}
            <template v-if="habit.kind === 'quantity'">
              · target {{ habit.target }} {{ habit.unit }}
            </template>
          </p>
          <ActivityGrid :days="habit.days" :unit="habit.unit" />
        </CardContent>
      </Card>
    </template>
  </div>
</template>

<style lang="scss" scoped src="./index.scss"></style>
