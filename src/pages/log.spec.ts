// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { LogResponse } from '@/lib/api'

const day: LogResponse = {
  date: '2026-11-02',
  isToday: false,
  habits: [
    {
      id: 1, name: 'Plan the week', kind: 'checklist', unit: null, target: 2, notesEnabled: true, slot: 'morning',
      steps: [{ id: 11, label: 'Open PRs' }, { id: 12, label: 'Target' }],
      entry: { completed: true, value: 1, note: 'Ship Today', steps: [12] },
    },
    {
      id: 2, name: 'Recap', kind: 'journal', unit: null, target: null, notesEnabled: true, slot: 'morning',
      steps: [], entry: { completed: true, value: null, note: 'Hydra moving', steps: undefined },
    },
  ],
}

const saveLog = vi.fn().mockResolvedValue(day)

vi.mock('@/lib/api', () => ({
  fetchLog: () => Promise.resolve(day),
  saveLog: (...args: unknown[]) => saveLog(...args),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { date: '2026-11-02' } }),
  useRouter: () => ({ replace: vi.fn() }),
}))

describe('/log with checklist and journal habits', () => {
  it('sends the ticked steps for a checklist and the note for a journal', async () => {
    const Page = (await import('./log.vue')).default
    const wrapper = mount(Page)
    await flushPromises()

    await wrapper.find('footer button').trigger('click')
    await flushPromises()

    expect(saveLog).toHaveBeenCalledWith('2026-11-02', [
      { habitId: 1, completed: true, value: null, steps: [12], note: 'Ship Today' },
      { habitId: 2, completed: true, value: null, note: 'Hydra moving' },
    ])
  })
})
