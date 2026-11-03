<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { saveLog, type LogEntryInput, type TodayHabit } from '@/lib/api'

const props = defineProps<{ habit: TodayHabit, date: string }>()
const emit = defineEmits<{ saved: [] }>()

/** How long typing has to pause before a note saves itself (D-34). */
const NOTE_SAVE_DELAY = 800

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const completed = ref(false)
const value = ref<number | null>(null)
const ticked = ref<number[]>([])
const note = ref('')
const error = ref<string | null>(null)
const noteUnsaved = ref(false)

/** Re-seeded from every refetch, so the row always shows what the server holds. */
watch(
  () => props.habit,
  habit => {
    completed.value = habit.entry?.completed ?? false
    value.value = habit.entry?.value ?? null
    ticked.value = habit.entry?.steps ?? []
    // Never overwrite text that has not reached the server yet.
    if (!noteUnsaved.value) note.value = habit.entry?.note ?? ''
  },
  { immediate: true },
)

const isJournal = computed(() => props.habit.kind === 'journal')
/** A checklist with no steps yet ticks as a whole (D-30). */
const hasSteps = computed(() => props.habit.kind === 'checklist' && props.habit.steps.length > 0)
const showsTick = computed(() => !isJournal.value && props.habit.kind !== 'quantity' && !hasSteps.value)
const showsNote = computed(() => isJournal.value || props.habit.notesEnabled)

const carriedLabel = computed(() => {
  const from = props.habit.carriedFrom
  if (!from) return null
  const [year, month, day] = from.split('-').map(Number)
  return `from ${WEEKDAYS[new Date(year!, month! - 1, day!).getDay()]}`
})

/** One habit, one entry: a failed save can only ever undo this row (D-34). */
async function save(entry: Omit<LogEntryInput, 'habitId'>, revert: () => void): Promise<boolean> {
  error.value = null
  try {
    await saveLog(props.date, [{ habitId: props.habit.id, ...entry }])
    emit('saved')
    return true
  } catch (e) {
    revert()
    error.value = e instanceof Error ? e.message : 'Could not save that.'
    return false
  }
}

function toggle(next: boolean) {
  const before = completed.value
  completed.value = next
  void save({ completed: next }, () => { completed.value = before })
}

function toggleStep(id: number, on: boolean) {
  const before = ticked.value
  // Kept in the checklist's own order, whatever order they were ticked in.
  const next = props.habit.steps.map(step => step.id)
    .filter(stepId => (stepId === id ? on : before.includes(stepId)))
  ticked.value = next
  void save({ steps: next }, () => { ticked.value = before })
}

function changeAmount(raw: string | number) {
  const before = value.value
  const next = raw === '' ? null : Number(raw)
  value.value = next
  void save({ value: next }, () => { value.value = before })
}

let noteTimer: ReturnType<typeof setTimeout> | null = null

function typeNote(text: string) {
  note.value = text
  noteUnsaved.value = true
  if (noteTimer) clearTimeout(noteTimer)
  noteTimer = setTimeout(() => void flushNote(), NOTE_SAVE_DELAY)
}

/** Text the server has not got yet is kept on screen, never reverted (spec, Error handling). */
async function flushNote() {
  if (noteTimer) {
    clearTimeout(noteTimer)
    noteTimer = null
  }
  if (!noteUnsaved.value) return
  const saved = await save({ note: note.value }, () => {})
  if (saved) noteUnsaved.value = false
}

// Leaving mid-sentence must not lose the sentence (Review Focus 1).
onBeforeUnmount(() => {
  void flushNote()
})

const stepsDone = computed(() => `${ticked.value.length}/${props.habit.steps.length}`)
</script>

<template>
  <article class="today-habit" :class="{ 'today-habit--done': completed }">
    <div class="today-habit__head">
      <Checkbox
        v-if="showsTick"
        :id="`today-${habit.id}`"
        :model-value="completed"
        :aria-label="habit.name"
        @update:model-value="toggle(Boolean($event))"
      />
      <label :for="showsTick ? `today-${habit.id}` : undefined" class="today-habit__name">{{ habit.name }}</label>
      <span v-if="carriedLabel" class="today-habit__carried">{{ carriedLabel }}</span>
      <span v-if="hasSteps" class="today-habit__count">{{ stepsDone }}</span>
    </div>

    <p v-if="habit.question" class="today-habit__question">{{ habit.question }}</p>

    <ul v-if="hasSteps" class="today-habit__steps">
      <li v-for="step in habit.steps" :key="step.id" class="today-habit__step">
        <Checkbox
          :id="`step-${step.id}`"
          :model-value="ticked.includes(step.id)"
          @update:model-value="toggleStep(step.id, Boolean($event))"
        />
        <label :for="`step-${step.id}`">{{ step.label }}</label>
      </li>
    </ul>

    <div v-if="habit.kind === 'quantity'" class="today-habit__amount">
      <Input
        type="number"
        min="0"
        inputmode="decimal"
        :model-value="value ?? ''"
        class="today-habit__amount-input"
        :aria-label="`${habit.name} in ${habit.unit ?? 'units'}`"
        @change="changeAmount(($event.target as HTMLInputElement).value)"
      />
      <span class="today-habit__unit">{{ habit.unit }}</span>
      <span v-if="habit.target !== null" class="today-habit__unit">of {{ habit.target }}</span>
    </div>

    <Textarea
      v-if="showsNote"
      :model-value="note"
      :placeholder="isJournal ? 'Write it down' : 'Note'"
      class="today-habit__note"
      @update:model-value="typeNote(String($event))"
      @blur="flushNote"
    />

    <p v-if="error" class="today-habit__error">
      <template v-if="noteUnsaved">
        Not saved — {{ error }}
        <Button variant="link" size="sm" data-retry @click="flushNote">Retry</Button>
      </template>
      <template v-else>{{ error }}</template>
    </p>
  </article>
</template>

<style lang="scss" scoped src="./TodayHabit.scss"></style>
