<script setup lang="ts">
import { Input } from '@/components/ui/input'
import type { HabitSlot } from '@/lib/api'

const props = defineProps<{
  /** Prefixes every id, so the create form and each row's editor never collide. */
  idPrefix: string
  slot: HabitSlot
  weekdays: number[]
  question: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:slot': [value: HabitSlot]
  'update:weekdays': [value: number[]]
  'update:question': [value: string]
}>()

const DAYS = [
  { day: 1, short: 'M', name: 'Monday' },
  { day: 2, short: 'T', name: 'Tuesday' },
  { day: 3, short: 'W', name: 'Wednesday' },
  { day: 4, short: 'T', name: 'Thursday' },
  { day: 5, short: 'F', name: 'Friday' },
  { day: 6, short: 'S', name: 'Saturday' },
  { day: 7, short: 'S', name: 'Sunday' },
]

function toggleDay(day: number) {
  const next = props.weekdays.includes(day)
    ? props.weekdays.filter(d => d !== day)
    : [...props.weekdays, day]
  emit('update:weekdays', next.sort((a, b) => a - b))
}
</script>

<template>
  <div class="schedule-fields">
    <select
      :id="`${idPrefix}-slot`"
      :value="slot"
      :disabled="disabled"
      class="schedule-fields__slot"
      aria-label="Part of the day"
      @change="emit('update:slot', ($event.target as HTMLSelectElement).value as HabitSlot)"
    >
      <option value="morning">Morning (work)</option>
      <option value="evening">Evening (personal)</option>
    </select>

    <div :id="`${idPrefix}-days`" role="group" aria-label="Days it is listed" class="schedule-fields__days">
      <button
        v-for="{ day, short, name } in DAYS"
        :key="day"
        type="button"
        class="schedule-fields__day"
        :class="{ 'schedule-fields__day--on': weekdays.includes(day) }"
        :data-weekday="day"
        :aria-pressed="weekdays.includes(day)"
        :aria-label="name"
        :disabled="disabled"
        @click="toggleDay(day)"
      >{{ short }}</button>
    </div>

    <Input
      :id="`${idPrefix}-question`"
      :model-value="question"
      :disabled="disabled"
      maxlength="200"
      class="schedule-fields__question"
      placeholder="A question to ask yourself (optional)"
      aria-label="Question"
      @update:model-value="emit('update:question', String($event))"
    />
  </div>
</template>

<style lang="scss" scoped src="./HabitScheduleFields.scss"></style>
