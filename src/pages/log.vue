<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LogHabitCard from '@/components/LogHabitCard.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchLog, saveLog, type LogEntryInput, type LogHabit } from '@/lib/api'

interface Draft {
  completed: boolean
  value: number | null
  note: string
}

const route = useRoute()
const router = useRouter()

const habits = ref<LogHabit[]>([])
const drafts = ref<Record<number, Draft>>({})
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref<string | null>(null)
const maxDate = ref('')

const date = computed(() => {
  const fromQuery = route.query.date
  return typeof fromQuery === 'string' ? fromQuery : ''
})

function toDrafts(list: LogHabit[]): Record<number, Draft> {
  return Object.fromEntries(
    list.map(habit => [
      habit.id,
      {
        completed: habit.entry?.completed ?? false,
        value: habit.entry?.value ?? null,
        note: habit.entry?.note ?? '',
      },
    ]),
  )
}

async function load(target: string) {
  loading.value = true
  error.value = null
  saved.value = false
  try {
    const data = await fetchLog(target)
    habits.value = data.habits
    drafts.value = toDrafts(data.habits)
    // Derive maxDate from the browser's local calendar day on every load — not
    // only when the loaded day happens to be "today" — otherwise navigating
    // straight to a past date (e.g. /log?date=2026-01-05) leaves maxDate empty
    // and the Next button stays disabled forever (`date >= maxDate` is always
    // true against ''). The server is still the authority on future dates;
    // this is only a UI affordance.
    const now = new Date()
    maxDate.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load that day.'
  } finally {
    loading.value = false
  }
}

function goTo(target: string) {
  router.replace({ path: '/log', query: { date: target } })
}

function shift(days: number) {
  const [year, month, day] = date.value.split('-').map(Number)
  const moved = new Date(year!, month! - 1, day! + days)
  const key = `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, '0')}-${String(moved.getDate()).padStart(2, '0')}`
  goTo(key)
}

async function save() {
  saving.value = true
  error.value = null
  try {
    const entries: LogEntryInput[] = habits.value.map(habit => {
      const draft = drafts.value[habit.id]!
      // Omit `note` entirely for habits without notes — sending null would
      // erase a note written while the flag was on (D-6).
      return {
        habitId: habit.id,
        completed: draft.completed,
        value: habit.kind === 'quantity' ? draft.value : null,
        ...(habit.notesEnabled ? { note: draft.note } : {}),
      }
    })
    const data = await saveLog(date.value, entries)
    habits.value = data.habits
    drafts.value = toDrafts(data.habits)
    saved.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save that day.'
  } finally {
    saving.value = false
  }
}

watch(
  date,
  async target => {
    if (!target) {
      // No date in the query — land on today, formatted from local calendar
      // parts rather than a locale string or toISOString (which is UTC).
      const now = new Date()
      const guess = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const data = await fetchLog(guess)
      goTo(data.date)
      return
    }
    await load(target)
  },
  { immediate: true },
)
</script>

<template>
  <div class="log">
    <header class="log__header">
      <Button variant="outline" size="sm" @click="shift(-1)">Previous</Button>
      <Input
        type="date"
        :model-value="date"
        :max="maxDate || undefined"
        class="log__date"
        @update:model-value="goTo(String($event))"
      />
      <Button variant="outline" size="sm" :disabled="date >= maxDate" @click="shift(1)">Next</Button>
    </header>

    <p v-if="loading" class="log__state">Loading…</p>

    <p v-else-if="error" class="log__state log__state--error">{{ error }}</p>

    <template v-else>
      <div class="log__list">
        <LogHabitCard
          v-for="habit in habits"
          :key="habit.id"
          :habit="habit"
          :completed="drafts[habit.id]!.completed"
          :value="drafts[habit.id]!.value"
          :note="drafts[habit.id]!.note"
          @update:completed="drafts[habit.id]!.completed = $event"
          @update:value="drafts[habit.id]!.value = $event"
          @update:note="drafts[habit.id]!.note = $event"
        />
      </div>

      <footer class="log__footer">
        <Button :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save day' }}</Button>
        <span v-if="saved" class="log__saved">Saved</span>
      </footer>
    </template>
  </div>
</template>

<style lang="scss" scoped src="./log.scss"></style>
