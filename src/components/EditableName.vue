<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Input } from '@/components/ui/input'

const props = defineProps<{ name: string, busy: boolean }>()

const emit = defineEmits<{ rename: [value: string] }>()

const root = ref<HTMLElement | null>(null)
const editing = ref(false)
const draft = ref('')

/**
 * Escape unmounts the input, which can also fire blur. Without this flag the
 * cancel would be immediately undone by the blur handler committing.
 */
let cancelling = false

async function startEditing() {
  if (props.busy) return

  // Escape unmounts the input, and that unmount does not reliably fire blur —
  // so `cancelling` can still be set from a previous session. Left stale it
  // swallows the next legitimate blur-commit and silently discards a rename.
  cancelling = false

  draft.value = props.name
  editing.value = true

  await nextTick()
  const field = root.value?.querySelector('input')
  field?.focus()
  field?.select()
}

function commit() {
  const next = draft.value.trim()
  editing.value = false
  // An empty or unchanged name is a no-op rather than a failed request.
  if (!next || next === props.name) return
  emit('rename', next)
}

function cancel() {
  cancelling = true
  editing.value = false
}

function handleBlur() {
  if (cancelling) {
    cancelling = false
    return
  }
  commit()
}

/**
 * One handler for both keys on purpose: two `@keydown` bindings on the same
 * element do not coexist — the later one silently replaces the earlier, which
 * left Enter doing nothing at all.
 */
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    commit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  }
}
</script>

<template>
  <span ref="root" class="editable-name">
    <Input
      v-if="editing"
      :model-value="draft"
      :disabled="busy"
      maxlength="80"
      class="editable-name__input"
      :aria-label="`Rename ${name}`"
      @update:model-value="draft = String($event)"
      @blur="handleBlur"
      @keydown="handleKeydown"
    />

    <button
      v-else
      type="button"
      class="editable-name__button"
      :disabled="busy"
      :title="`Rename ${name}`"
      @click="startEditing"
    >
      {{ name }}
    </button>
  </span>
</template>

<style lang="scss" scoped src="./EditableName.scss"></style>
