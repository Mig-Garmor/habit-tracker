// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { LogHabit } from '@/lib/api'
import LogHabitCard from './LogHabitCard.vue'

function habit(overrides: Partial<LogHabit> = {}): LogHabit {
  return {
    id: 1, name: 'Plan the week', kind: 'checklist', unit: null, target: 2, notesEnabled: false,
    slot: 'morning', steps: [{ id: 11, label: 'Open PRs' }, { id: 12, label: 'Target' }], entry: null,
    ...overrides,
  }
}

function mountCard(overrides: Partial<LogHabit> = {}, steps: number[] = []) {
  return mount(LogHabitCard, {
    props: { habit: habit(overrides), completed: false, value: null, note: '', steps },
  })
}

describe('LogHabitCard', () => {
  it('lists a checklist’s steps and reports the full set when one is ticked', async () => {
    const wrapper = mountCard({}, [11])
    const boxes = wrapper.findAll('[role="checkbox"]')
    expect(boxes).toHaveLength(2)
    expect(wrapper.text()).toContain('Open PRs')

    await boxes[1]!.trigger('click')
    expect(wrapper.emitted('update:steps')).toEqual([[[11, 12]]])
  })

  it('ticks a checklist with no steps as a whole', async () => {
    const wrapper = mountCard({ steps: [] })
    await wrapper.find('[role="checkbox"]').trigger('click')
    expect(wrapper.emitted('update:completed')).toEqual([[true]])
  })

  it('gives a journal somewhere to write and no tick', () => {
    const wrapper = mountCard({ kind: 'journal', notesEnabled: true, steps: [] })
    expect(wrapper.find('[role="checkbox"]').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(true)
  })
})
