<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { LogHabit } from '@/lib/api'

import { computed } from 'vue'

const props = defineProps<{
  habit: LogHabit
  completed: boolean
  value: number | null
  note: string
  steps: number[]
}>()

const emit = defineEmits<{
  'update:completed': [value: boolean]
  'update:value': [value: number | null]
  'update:note': [value: string]
  'update:steps': [value: number[]]
}>()

/** A checklist with no steps yet ticks as a whole (D-30); a journal never ticks (D-32). */
const hasSteps = computed(() => props.habit.kind === 'checklist' && props.habit.steps.length > 0)
const showsTick = computed(() => props.habit.kind === 'binary' || (props.habit.kind === 'checklist' && !hasSteps.value))

function toggleStep(id: number, on: boolean) {
  emit('update:steps', props.habit.steps.map(step => step.id)
    .filter(stepId => (stepId === id ? on : props.steps.includes(stepId))))
}
</script>

<template>
  <div class="log-card">
    <div class="log-card__head">
      <Checkbox
        v-if="showsTick"
        :id="`done-${habit.id}`"
        :model-value="completed"
        @update:model-value="$emit('update:completed', Boolean($event))"
      />
      <Label :for="showsTick ? `done-${habit.id}` : `value-${habit.id}`" class="log-card__name">
        {{ habit.name }}
      </Label>
    </div>

    <ul v-if="hasSteps" class="log-card__steps">
      <li v-for="step in habit.steps" :key="step.id" class="log-card__step">
        <Checkbox
          :id="`log-step-${step.id}`"
          :model-value="steps.includes(step.id)"
          @update:model-value="toggleStep(step.id, Boolean($event))"
        />
        <Label :for="`log-step-${step.id}`">{{ step.label }}</Label>
      </li>
    </ul>

    <div v-if="habit.kind === 'quantity'" class="log-card__quantity">
      <Input
        :id="`value-${habit.id}`"
        type="number"
        min="0"
        inputmode="numeric"
        :model-value="value ?? ''"
        class="log-card__input"
        @update:model-value="$emit('update:value', $event === '' ? null : Number($event))"
      />
      <span class="log-card__unit">{{ habit.unit }}</span>
      <Button
        v-if="habit.target !== null"
        type="button"
        variant="outline"
        size="sm"
        @click="$emit('update:value', habit.target)"
      >
        {{ habit.target }}
      </Button>
    </div>

    <Textarea
      v-if="habit.notesEnabled"
      :model-value="note"
      placeholder="What did you do?"
      class="log-card__note"
      @update:model-value="$emit('update:note', String($event))"
    />
  </div>
</template>

<style lang="scss" scoped src="./LogHabitCard.scss"></style>
