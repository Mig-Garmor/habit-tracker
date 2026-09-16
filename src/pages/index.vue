<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check } from 'lucide-vue-next'
import ActivityGrid from '@/components/ActivityGrid.vue'
import HealthPill from '@/components/HealthPill.vue'
import { isTruncated, truncateName } from '@/lib/truncate'
import { Button } from '@/components/ui/button'
import { fetchDashboard, updateHabit, type DashboardHabit, type DashboardResponse } from '@/lib/api'

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
  error.value = null
  try {
    await updateHabit(habitId, { status: 'upcoming' })
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not move that habit.'
  } finally {
    parkingId.value = null
  }
}

/**
 * Whether today is already logged.
 *
 * The payload answers this directly — today has its own row in `days` — so
 * there is nothing to infer from a last-completed date, and the API needed no
 * new field. `completed` is the server's judgement, never the client's (D-1):
 * for a quantity habit it means a value above zero, so showing up for two
 * minutes of a fifteen-minute target counts. That is deliberately the same
 * rule the streak, the health pill and the grid on this row already use — a
 * tick that disagreed with the shading beside it would be worse than no tick.
 */
function doneToday(habit: DashboardHabit): boolean {
  return habit.days.some(day => day.date === data.value?.today && day.completed)
}

/**
 * What is still to do, then what is done.
 *
 * Two filters rather than a sort, so the habits' own order survives inside
 * each group — that order is what was dragged into place on /habits and stored
 * as `position`, and a comparator returning 0 for equal members is only stable
 * by specification, not by inspection.
 *
 * Nothing on this screen logs a habit, so the list cannot reshuffle underneath
 * someone mid-glance; it settles once per load.
 */
const orderedHabits = computed(() => {
  const habits = data.value?.habits ?? []
  return [...habits.filter(h => !doneToday(h)), ...habits.filter(h => doneToday(h))]
})

/**
 * The facts line, written short enough to survive a phone.
 *
 * The long form ('4× a week · 0 week streak · 15 minutes') does not fit beside
 * a name and a health pill at 375px, and truncating it cut words in half —
 * '0 week s…' is worse than no streak at all, because it looks broken rather
 * than brief. Abbreviations are unambiguous in context: a grid of weeks is
 * right underneath.
 */
function facts(habit: DashboardHabit): string {
  const cadence = habit.timesPerWeek === 7 ? 'daily' : `${habit.timesPerWeek}×/wk`
  return `${cadence} · ${habit.streak}w streak`
}

/** The target, which is the first thing to go when the line will not fit. */
function targetText(habit: DashboardHabit): string | null {
  if (habit.kind !== 'quantity' || habit.target === null) return null
  return `${habit.target} ${habit.unit ?? ''}`.trim()
}

onMounted(load)
</script>

<template>
  <div class="dashboard">
    <p v-if="loading" class="dashboard__state">Loading…</p>

    <div v-else-if="error && !data" class="dashboard__state dashboard__state--error">
      <p>{{ error }}</p>
      <Button variant="outline" size="sm" @click="load">Try again</Button>
    </div>

    <template v-else-if="data">
      <p v-if="error" class="dashboard__error">{{ error }}</p>

      <section v-if="data.warnings.length" class="dashboard__warnings">
        <h2 class="dashboard__warnings-title">Slipping</h2>
        <p class="dashboard__warnings-lead">
          These aren't sticking. Park them until the rest are consistent.
        </p>
        <ul class="dashboard__warnings-list">
          <li v-for="warning in data.warnings" :key="warning.habitId" class="dashboard__warning">
            <span class="dashboard__warning-name">{{ warning.name }}</span>
            <span class="dashboard__warning-rate">{{ Math.round(warning.rate * 100) }}% of recent weeks</span>
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

      <!--
        One line of chrome, not three. Everything that used to stack — name,
        cadence, streak, target, health — sits on a single row, so a habit is
        about a third of its old height and every card is the same height
        rather than varying with how much text it happens to carry.
      -->
      <!--
        Text beside the grid, not above it. The grid is only ~150px wide, so a
        full-width card leaves a column of unused space to its right — and the
        text was being crammed onto one line, and truncated, while that space
        sat empty. Stacking the text into that column reads better AND makes
        the row shorter, because its height becomes the taller of the two
        rather than their sum.
      -->
      <article v-for="habit in orderedHabits" :key="habit.id" class="dashboard__habit">
        <div class="dashboard__habit-info">
          <!--
            The tick sits beside the name rather than inside it: the name
            truncates, and a tick inside would be the first thing an ellipsis
            ate on a long habit.
          -->
          <div class="dashboard__habit-heading">
            <h2 class="dashboard__habit-name" :title="isTruncated(habit.name) ? habit.name : undefined">
              {{ truncateName(habit.name) }}
            </h2>
            <Check
              v-if="doneToday(habit)"
              class="dashboard__habit-tick"
              role="img"
              aria-label="Done today"
            />
          </div>
          <!--
            A display affordance, not a calculation (D-26 is about the latter —
            no scoring path branches on daily). "Daily" is what a person calls
            a cadence of 7; "7× a week" would be worse writing.
          -->
          <span class="dashboard__habit-facts">{{ facts(habit) }}</span>
          <span v-if="targetText(habit)" class="dashboard__habit-facts">
            target {{ targetText(habit) }}
          </span>
          <HealthPill :health="habit.health" :rate="habit.rate" class="dashboard__habit-pill" />
        </div>
        <ActivityGrid
          class="dashboard__habit-grid"
          :days="habit.days"
          :unit="habit.unit"
          :weeks="habit.weeks"
          :today="data.today"
        />
      </article>
    </template>
  </div>
</template>

<style lang="scss" scoped src="./index.scss"></style>
