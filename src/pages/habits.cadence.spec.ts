// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateHabit = vi.fn().mockImplementation((id: number, patch: Record<string, unknown>) =>
  Promise.resolve({ id, name: 'Gym', kind: 'binary', unit: null, target: null,
    notesEnabled: false, status: 'active', activatedAt: '2026-09-01',
    createdAt: '2026-09-01T00:00:00.000Z', timesPerWeek: patch.timesPerWeek ?? 4 }))

const createHabit = vi.fn().mockResolvedValue({ id: 2, name: 'Gym', timesPerWeek: 4 })

vi.mock('@/lib/api', () => ({
  fetchHabits: () => Promise.resolve([
    {
      id: 1, name: 'Gym', kind: 'binary', unit: null, target: null, notesEnabled: false,
      status: 'active', activatedAt: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z',
      timesPerWeek: 4,
    },
    {
      id: 9, name: 'Upload a video', kind: 'binary', unit: null, target: null,
      notesEnabled: false, status: 'upcoming', activatedAt: null,
      createdAt: '2026-09-01T00:00:00.000Z', timesPerWeek: 1,
    },
  ]),
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

  it('submits daily when the add-form cadence is cleared (item 10)', async () => {
    const HabitsPage = (await import('./habits.vue')).default
    const wrapper = mount(HabitsPage, { attachTo: document.body })
    await flushPromises()

    await wrapper.find('#new-name').setValue('Gym')
    // Vue's `.number` modifier passes an emptied field through as `''`
    // rather than coercing or rejecting it.
    await wrapper.find('#new-cadence').setValue('')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createHabit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Gym', timesPerWeek: 7 }),
    )
  })

  it('shows an error and reverts when the row editor cadence is cleared', async () => {
    const HabitsPage = (await import('./habits.vue')).default
    const wrapper = mount(HabitsPage, { attachTo: document.body })
    await flushPromises()

    const field = wrapper.find('[data-cadence="1"]')
    await field.setValue('')
    await field.trigger('blur')
    await flushPromises()

    expect(updateHabit).not.toHaveBeenCalled()
    expect(wrapper.find<HTMLInputElement>('[data-cadence="1"]').element.value).toBe('4')
    expect(wrapper.text()).toContain('reverted')
  })
})

/**
 * The cadence control was on active rows only, so a habit waiting in the queue
 * could not have one set — and every habit created before cadence existed was
 * stuck at the default until activated. That is backwards for a queue whose
 * purpose is deciding what to take on: "this is once a week" is exactly what
 * you want to know BEFORE activating.
 */
describe('cadence on an upcoming habit', () => {
  beforeEach(() => {
    updateHabit.mockClear()
    document.body.innerHTML = ''
  })

  it('shows the cadence of a habit waiting in the queue', async () => {
    const HabitsPage = (await import('./habits.vue')).default
    const wrapper = mount(HabitsPage, { attachTo: document.body })
    await flushPromises()
    const field = wrapper.find<HTMLInputElement>('[data-cadence="9"]')
    expect(field.exists()).toBe(true)
    expect(field.element.value).toBe('1')
  })

  it('saves a cadence change without needing the habit activated first', async () => {
    const HabitsPage = (await import('./habits.vue')).default
    const wrapper = mount(HabitsPage, { attachTo: document.body })
    await flushPromises()
    const field = wrapper.find('[data-cadence="9"]')
    await field.setValue('3')
    await field.trigger('blur')
    await flushPromises()
    expect(updateHabit).toHaveBeenCalledWith(9, { timesPerWeek: 3 })
  })
})
