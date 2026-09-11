<script setup lang="ts">
import { Checkbox } from '@/components/ui/checkbox'
import type { TodayHabit } from '@/lib/api'

defineProps<{ habit: TodayHabit; pending: boolean }>()
defineEmits<{ toggle: [id: number] }>()
</script>

<template>
  <li class="habit-item" :class="{ 'habit-item--done': habit.completed }">
    <Checkbox
      :id="`habit-${habit.id}`"
      :model-value="habit.completed"
      :disabled="pending"
      @update:model-value="$emit('toggle', habit.id)"
    />
    <label :for="`habit-${habit.id}`" class="habit-item__label">
      {{ habit.name }}
    </label>
  </li>
</template>

<style lang="scss" scoped src="./HabitItem.scss"></style>
