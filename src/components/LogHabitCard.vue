<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { LogHabit } from '@/lib/api'

defineProps<{
  habit: LogHabit
  completed: boolean
  value: number | null
  note: string
}>()

defineEmits<{
  'update:completed': [value: boolean]
  'update:value': [value: number | null]
  'update:note': [value: string]
}>()
</script>

<template>
  <div class="log-card">
    <div class="log-card__head">
      <Checkbox
        v-if="habit.kind === 'binary'"
        :id="`done-${habit.id}`"
        :model-value="completed"
        @update:model-value="$emit('update:completed', Boolean($event))"
      />
      <Label :for="habit.kind === 'binary' ? `done-${habit.id}` : `value-${habit.id}`" class="log-card__name">
        {{ habit.name }}
      </Label>
    </div>

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
