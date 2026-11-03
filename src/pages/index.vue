<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import SlotBar from '@/components/SlotBar.vue'
import TodayHabit from '@/components/TodayHabit.vue'
import { Button } from '@/components/ui/button'
import { fetchToday, type HabitSlot, type TodayResponse } from '@/lib/api'
import { dateKey, frontSlot } from '@/lib/day-part'

const SLOTS: { slot: HabitSlot, title: string }[] = [
  { slot: 'morning', title: 'Morning' },
  { slot: 'evening', title: 'Evening' },
]

/** Checked once a minute: enough to catch five o'clock and midnight. */
const CLOCK_TICK = 60_000

const now = ref(new Date())
const data = ref<TodayResponse | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
/** A slot brought forward by hand, until the clock next changes its mind. */
const override = ref<HabitSlot | null>(null)

const date = computed(() => dateKey(now.value))
const clockFront = computed(() => frontSlot(now.value))
const front = computed<HabitSlot>(() => {
  if (data.value && !data.value.morningVisible) return 'evening'
  return override.value ?? clockFront.value
})

const visibleSlots = computed(() =>
  SLOTS.filter(({ slot }) => slot === 'evening' || (data.value?.morningVisible ?? false)),
)

async function load(quiet = false) {
  if (!quiet) loading.value = true
  error.value = null
  try {
    data.value = await fetchToday(date.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load today.'
  } finally {
    loading.value = false
  }
}

watch(clockFront, () => {
  override.value = null
})
// Left open past midnight, the page moves on to the new day.
watch(date, () => void load())

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void load()
  timer = setInterval(() => {
    now.value = new Date()
  }, CLOCK_TICK)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="today">
    <p v-if="loading" class="today__state">Loading…</p>

    <div v-else-if="error && !data" class="today__state today__state--error">
      <p>{{ error }}</p>
      <Button variant="outline" size="sm" @click="load()">Try again</Button>
    </div>

    <template v-else-if="data">
      <p v-if="error" class="today__error">{{ error }}</p>

      <template v-for="{ slot, title } in visibleSlots" :key="slot">
        <section v-if="slot === front" class="today__slot today__slot--front">
          <header class="today__slot-head">
            <h2 class="today__slot-title">{{ title }}</h2>
            <span class="today__slot-count">{{ data.slots[slot].done }} of {{ data.slots[slot].total }} done</span>
          </header>
          <p v-if="data.slots[slot].habits.length === 0" class="today__state">
            Nothing for the {{ title.toLowerCase() }} today.
          </p>
          <TodayHabit
            v-for="habit in data.slots[slot].habits"
            :key="habit.id"
            :habit="habit"
            :date="data.date"
            @saved="load(true)"
          />
        </section>

        <SlotBar
          v-else
          :data-slot-bar="slot"
          :label="title"
          :progress="data.slots[slot].progress"
          :done="data.slots[slot].done"
          :total="data.slots[slot].total"
          @expand="override = slot"
        />
      </template>
    </template>
  </div>
</template>

<style lang="scss" scoped src="./index.scss"></style>
