<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** A step as edited: no id until the server has created it (D-35). */
export interface StepDraft {
  id?: number
  label: string
}

const props = defineProps<{ modelValue: StepDraft[], disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: StepDraft[]] }>()

const newLabel = ref('')

function rename(index: number, label: string) {
  emit('update:modelValue', props.modelValue.map((step, i) => (i === index ? { ...step, label } : step)))
}

function remove(index: number) {
  emit('update:modelValue', props.modelValue.filter((_, i) => i !== index))
}

function move(index: number, delta: number) {
  const to = index + delta
  if (to < 0 || to >= props.modelValue.length) return
  const next = [...props.modelValue]
  ;[next[index], next[to]] = [next[to]!, next[index]!]
  emit('update:modelValue', next)
}

function add() {
  const label = newLabel.value.trim()
  if (!label) return
  emit('update:modelValue', [...props.modelValue, { label }])
  newLabel.value = ''
}
</script>

<template>
  <div class="steps-editor">
    <ol class="steps-editor__list">
      <li v-for="(step, index) in modelValue" :key="step.id ?? `new-${index}`" class="steps-editor__row">
        <Input
          :model-value="step.label"
          :disabled="disabled"
          maxlength="80"
          class="steps-editor__label"
          :data-step-label="index"
          :aria-label="`Step ${index + 1}`"
          @update:model-value="rename(index, String($event))"
        />
        <Button variant="ghost" size="sm" :disabled="disabled || index === 0" :data-step-up="index" :aria-label="`Move step ${index + 1} up`" @click="move(index, -1)">↑</Button>
        <Button variant="ghost" size="sm" :disabled="disabled || index === modelValue.length - 1" :data-step-down="index" :aria-label="`Move step ${index + 1} down`" @click="move(index, 1)">↓</Button>
        <Button variant="ghost" size="sm" :disabled="disabled" :data-step-remove="index" :aria-label="`Remove step ${index + 1}`" @click="remove(index)">✕</Button>
      </li>
    </ol>
    <div class="steps-editor__row">
      <Input
        v-model="newLabel"
        :disabled="disabled"
        maxlength="80"
        class="steps-editor__label"
        placeholder="Add a step"
        aria-label="New step"
        data-step-new
        @keydown.enter.prevent="add"
      />
      <Button variant="outline" size="sm" :disabled="disabled || modelValue.length >= 20" data-step-add @click="add">Add</Button>
    </div>
  </div>
</template>

<style lang="scss" scoped src="./StepsEditor.scss"></style>
