<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ label: string, progress: number, done: number, total: number }>()
defineEmits<{ expand: [] }>()

const percent = computed(() => Math.round(props.progress * 100))
</script>

<template>
  <!-- The folded slot (D-29): one line, and pressing it brings the slot forward. -->
  <button type="button" class="slot-bar" @click="$emit('expand')">
    <span class="slot-bar__label">{{ label }}</span>
    <span
      class="slot-bar__track"
      role="progressbar"
      :aria-label="`${label} progress`"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="percent"
    >
      <span class="slot-bar__fill" :style="{ width: `${percent}%` }" />
    </span>
    <span class="slot-bar__count">{{ done }} of {{ total }} done</span>
  </button>
</template>

<style lang="scss" scoped src="./SlotBar.scss"></style>
