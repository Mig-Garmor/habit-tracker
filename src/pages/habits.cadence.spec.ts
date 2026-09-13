// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateHabit = vi.fn().mockImplementation((id: number, patch: Record<string, unknown>) =>
  Promise.resolve({ id, name: 'Gym', kind: 'binary', unit: null, target: null,
    notesEnabled: false, status: 'active', activatedAt: '2026-09-01',
    createdAt: '2026-09-01T00:00:00.000Z', timesPerWeek: patch.timesPerWeek ?? 4 }))

const createHabit = vi.fn().mockResolvedValue({ id: 2, name: 'Gym', timesPerWeek: 4 })

vi.mock('@/lib/api', () => ({
  fetchHabits: () => Promise.resolve([{
    id: 1, name: 'Gym', kind: 'binary', unit: null, target: null, notesEnabled: false,
    status: 'active', activatedAt: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z',
    timesPerWeek: 4,
  }]),
  fetchDashboard: () => Promise.resolve({ habits: [] }),
  createHabit: (input: Record<string, unknown>) => createHabit(input),
  reorderHabits: vi.fn(),
  updateHabit: (id: number, patch: Record<string, unknown>) => updateHabit(id, patch),
}))

describe('editing a cadence', () => {
  beforeEach(() => {
    updateHabit.mockClear()
    createHabit.mockClear()
    document.body.innerHTML = ''
  })

  it('shows the habit’s current cadence', async () => {
    const HabitsPage = (await import('./habits.vue')).default
    const wrapper = mount(HabitsPage, { attachTo: document.body })
    await flushPromises()
    const field = wrapper.find<HTMLInputElement>('[data-cadence="1"]')
    expect(field.element.value).toBe('4')
  })

  it('saves a changed cadence', async () => {
    const HabitsPage = (await import('./habits.vue')).default
    const wrapper = mount(HabitsPage, { attachTo: document.body })
    await flushPromises()
    const field = wrapper.find('[data-cadence="1"]')
    await field.setValue('2')
    await field.trigger('blur')
    await flushPromises()
    expect(updateHabit).toHaveBeenCalledWith(1, { timesPerWeek: 2 })
  })

  it('creates a habit with the chosen cadence', async () => {
    const HabitsPage = (await import('./habits.vue')).default
    const wrapper = mount(HabitsPage, { attachTo: document.body })
    await flushPromises()

    await wrapper.find('#new-name').setValue('Gym')
    await wrapper.find('#new-cadence').setValue('4')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createHabit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Gym', timesPerWeek: 4 }),
    )
  })
})
