<script setup lang="ts">
import { computed } from 'vue'
import type { Health } from '@/lib/api'

const props = defineProps<{ health: Health, rate: number }>()

const LABELS: Record<Health, string> = {
  new: 'Settling in',
  struggling: 'Slipping',
  steady: 'Steady',
  consistent: 'Consistent',
}

const label = computed(() => LABELS[props.health])
const percent = computed(() => `${Math.round(props.rate * 100)}%`)
</script>

<template>
  <span class="health-pill" :class="`is-${health}`">
    <span class="health-pill__label">{{ label }}</span>
    <span v-if="health !== 'new'" class="health-pill__rate">{{ percent }}</span>
  </span>
</template>

<style lang="scss" scoped src="./HealthPill.scss"></style>
