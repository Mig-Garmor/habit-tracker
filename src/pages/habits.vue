<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import EditableName from '@/components/EditableName.vue'
import HealthPill from '@/components/HealthPill.vue'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createHabit, fetchDashboard, fetchHabits, updateHabit,
  type Habit, type Health,
} from '@/lib/api'

const all = ref<Habit[]>([])
const health = ref<Record<number, { health: Health, rate: number }>>({})
const loading = ref(true)
const error = ref<string | null>(null)
const busyId = ref<number | null>(null)
const pendingActivation = ref<Habit | null>(null)
// Draft values for the inline target editor (R13) — keyed by habit id so
// each row's <input> can be edited independently of the last-loaded habit.
const targetDrafts = ref<Record<number, number | null>>({})

const form = ref({ name: '', isQuantity: false, unit: 'minutes', target: 10, notesEnabled: false })

const active = computed(() => all.value.filter(h => h.status === 'active'))
const upcoming = computed(() => all.value.filter(h => h.status === 'upcoming'))
const archived = computed(() => all.value.filter(h => h.status === 'archived'))

const consistentCount = computed(
  () => active.value.filter(h => health.value[h.id]?.health === 'consistent').length,
)

const strugglingNames = computed(
  () => active.value.filter(h => health.value[h.id]?.health === 'struggling').map(h => h.name),
)

async function load() {
  loading.value = true
  error.value = null
  try {
    const [habits, dashboard] = await Promise.all([fetchHabits(), fetchDashboard()])
    all.value = habits
    health.value = Object.fromEntries(
      dashboard.habits.map(h => [h.id, { health: h.health, rate: h.rate }]),
    )
    targetDrafts.value = Object.fromEntries(
      habits.filter(h => h.kind === 'quantity').map(h => [h.id, h.target]),
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load habits.'
  } finally {
    loading.value = false
  }
}

async function setStatus(habit: Habit, status: Habit['status']) {
  busyId.value = habit.id
  error.value = null
  try {
    await updateHabit(habit.id, { status })
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not update that habit.'
  } finally {
    busyId.value = null
  }
}

/** Rename an active or upcoming habit. Archived names stay fixed so the
 * label on already-logged history cannot be rewritten. */
async function renameHabit(habit: Habit, name: string) {
  busyId.value = habit.id
  error.value = null
  try {
    await updateHabit(habit.id, { name })
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not rename that habit.'
  } finally {
    busyId.value = null
  }
}

/**
 * Minimal inline target editor for active quantity habits (R13) — the only
 * UI path to the app's headline requirement (raise Meditation 5 → 10 and
 * have past entries re-shade, D-2). Scope is deliberately narrow: target
 * only, active quantity habits only. Commits on blur or Enter.
 */
async function updateTarget(habit: Habit) {
  const draft = targetDrafts.value[habit.id]
  if (draft === habit.target || draft === null || draft === undefined || !(draft > 0)) {
    targetDrafts.value[habit.id] = habit.target
    return
  }

  busyId.value = habit.id
  error.value = null
  try {
    await updateHabit(habit.id, { target: draft })
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not update that target.'
    targetDrafts.value[habit.id] = habit.target
  } finally {
    busyId.value = null
  }
}

/** Activating while something is slipping asks first — but never refuses. */
function requestActivation(habit: Habit) {
  if (strugglingNames.value.length > 0) {
    pendingActivation.value = habit
    return
  }
  void setStatus(habit, 'active')
}

async function confirmActivation() {
  const habit = pendingActivation.value
  pendingActivation.value = null
  if (habit) await setStatus(habit, 'active')
}

async function submit(status: 'active' | 'upcoming') {
  error.value = null
  try {
    await createHabit({
      name: form.value.name,
      kind: form.value.isQuantity ? 'quantity' : 'binary',
      unit: form.value.isQuantity ? form.value.unit : null,
      target: form.value.isQuantity ? form.value.target : null,
      notesEnabled: form.value.notesEnabled,
      status,
    })
    form.value = { name: '', isQuantity: false, unit: 'minutes', target: 10, notesEnabled: false }
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not add that habit.'
  }
}

onMounted(load)
</script>

<template>
  <div class="habits">
    <p v-if="error" class="habits__error">{{ error }}</p>
    <p v-if="loading" class="habits__state">Loading…</p>

    <template v-else>
      <section class="habits__section">
        <header class="habits__section-head">
          <h2 class="habits__title">Active</h2>
          <span class="habits__count">{{ consistentCount }} of {{ active.length }} consistent</span>
        </header>

        <p v-if="active.length === 0" class="habits__state">Nothing active yet.</p>

        <ul class="habits__list">
          <li v-for="habit in active" :key="habit.id" class="habits__row">
            <EditableName
              class="habits__name"
              :name="habit.name"
              :busy="busyId === habit.id"
              @rename="renameHabit(habit, $event)"
            />
            <div v-if="habit.kind === 'quantity'" class="habits__target">
              <Input
                type="number"
                min="0"
                step="any"
                inputmode="decimal"
                :model-value="targetDrafts[habit.id] ?? ''"
                :disabled="busyId === habit.id"
                class="habits__target-input"
                :aria-label="`Daily target for ${habit.name}`"
                @update:model-value="targetDrafts[habit.id] = $event === '' ? null : Number($event)"
                @blur="updateTarget(habit)"
                @keydown.enter.prevent="($event.target as HTMLElement).blur()"
              />
              <span class="habits__target-unit">{{ habit.unit }}</span>
            </div>
            <HealthPill
              v-if="health[habit.id]"
              :health="health[habit.id]!.health"
              :rate="health[habit.id]!.rate"
            />
            <Button variant="outline" size="sm" :disabled="busyId === habit.id" @click="setStatus(habit, 'upcoming')">
              Park
            </Button>
            <Button variant="ghost" size="sm" :disabled="busyId === habit.id" @click="setStatus(habit, 'archived')">
              Archive
            </Button>
          </li>
        </ul>
      </section>

      <section class="habits__section">
        <h2 class="habits__title">Upcoming</h2>
        <p v-if="upcoming.length === 0" class="habits__state">
          Nothing queued. Add habits here to take on later.
        </p>
        <ul class="habits__list">
          <li v-for="habit in upcoming" :key="habit.id" class="habits__row">
            <EditableName
              class="habits__name"
              :name="habit.name"
              :busy="busyId === habit.id"
              @rename="renameHabit(habit, $event)"
            />
            <Button variant="outline" size="sm" :disabled="busyId === habit.id" @click="requestActivation(habit)">
              Activate
            </Button>
          </li>
        </ul>
      </section>

      <section v-if="archived.length" class="habits__section">
        <h2 class="habits__title">Archived</h2>
        <ul class="habits__list">
          <li v-for="habit in archived" :key="habit.id" class="habits__row">
            <span class="habits__name habits__name--muted">{{ habit.name }}</span>
            <Button variant="ghost" size="sm" :disabled="busyId === habit.id" @click="setStatus(habit, 'upcoming')">
              Restore
            </Button>
          </li>
        </ul>
      </section>

      <section class="habits__section">
        <h2 class="habits__title">Add a habit</h2>
        <form class="habits__form" @submit.prevent="submit('active')">
          <div class="habits__field">
            <Label for="new-name">Name</Label>
            <Input id="new-name" v-model="form.name" required placeholder="Read a chapter" />
          </div>

          <label class="habits__toggle">
            <Checkbox
              :model-value="form.isQuantity"
              @update:model-value="form.isQuantity = Boolean($event)"
            />
            <span>Track an amount each day</span>
          </label>

          <div v-if="form.isQuantity" class="habits__row habits__row--compact">
            <div class="habits__field">
              <Label for="new-unit">Unit</Label>
              <Input id="new-unit" v-model="form.unit" />
            </div>
            <div class="habits__field">
              <Label for="new-target">Daily target</Label>
              <Input id="new-target" v-model.number="form.target" type="number" min="1" />
            </div>
          </div>

          <label class="habits__toggle">
            <Checkbox
              :model-value="form.notesEnabled"
              @update:model-value="form.notesEnabled = Boolean($event)"
            />
            <span>Let me add a note each day</span>
          </label>

          <div class="habits__actions">
            <Button type="submit" :disabled="!form.name.trim()">Add as active</Button>
            <Button
              type="button"
              variant="outline"
              :disabled="!form.name.trim()"
              @click="submit('upcoming')"
            >
              Add to upcoming
            </Button>
          </div>
        </form>
      </section>
    </template>

    <AlertDialog :open="pendingActivation !== null">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Take on another habit?</AlertDialogTitle>
          <AlertDialogDescription>
            {{ strugglingNames.join(' and ') }}
            {{ strugglingNames.length === 1 ? 'is' : 'are' }} slipping.
            Adding more now tends to make that worse — but it's your call.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="pendingActivation = null">Not yet</AlertDialogCancel>
          <AlertDialogAction @click="confirmActivation">Activate anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<style lang="scss" scoped src="./habits.scss"></style>
