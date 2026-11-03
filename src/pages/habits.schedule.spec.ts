// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ALL = [1, 2, 3, 4, 5, 6, 7]

const createHabit = vi.fn().mockResolvedValue({ id: 20 })
const updateHabit = vi.fn().mockResolvedValue({ id: 1 })
const saveSteps = vi.fn().mockResolvedValue({ id: 5 })

vi.mock('@/lib/api', () => ({
  fetchHabits: () => Promise.resolve([
    {
      id: 1, name: 'Gym', kind: 'binary', unit: null, target: null, notesEnabled: false,
      status: 'active', activatedAt: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z',
      timesPerWeek: 4, slot: 'evening', weekdays: ALL, question: null, steps: [],
    },
    {
      id: 5, name: 'Plan', kind: 'checklist', unit: null, target: 2, notesEnabled: true,
      status: 'active', activatedAt: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z',
      timesPerWeek: 1, slot: 'morning', weekdays: [1], question: 'By Friday?',
      steps: [{ id: 51, label: 'Open PRs', position: 0 }, { id: 52, label: 'Target', position: 1 }],
    },
    {
      id: 6, name: 'Recap', kind: 'journal', unit: null, target: null, notesEnabled: true,
      status: 'active', activatedAt: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z',
      timesPerWeek: 5, slot: 'morning', weekdays: [1, 2, 3, 4, 5], question: null, steps: [],
    },
  ]),
  fetchDashboard: () => Promise.resolve({ habits: [] }),
  createHabit: (input: unknown) => createHabit(input),
  updateHabit: (id: number, patch: unknown) => updateHabit(id, patch),
  saveSteps: (id: number, steps: unknown) => saveSteps(id, steps),
  reorderHabits: vi.fn(),
}))

async function mountPage() {
  const HabitsPage = (await import('./habits.vue')).default
  const wrapper = mount(HabitsPage, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

async function openEditor(wrapper: Awaited<ReturnType<typeof mountPage>>, id: number) {
  await wrapper.find(`[data-menu="${id}"]`).trigger('click')
  await flushPromises()
  document.querySelector<HTMLElement>(`[data-edit="${id}"]`)!.click()
  await flushPromises()
}

beforeEach(() => {
  createHabit.mockClear()
  updateHabit.mockClear()
  saveSteps.mockClear()
  document.body.innerHTML = ''
})

describe('adding a habit with a schedule', () => {
  it('sends its kind, slot, weekdays and question', async () => {
    const wrapper = await mountPage()
    await wrapper.find('#new-name').setValue('Plan the week')
    await wrapper.find('#new-kind').setValue('checklist')
    await wrapper.find('#new-slot').setValue('morning')
    for (const day of [2, 3, 4, 5, 6, 7]) await wrapper.find(`#new-days [data-weekday="${day}"]`).trigger('click')
    await wrapper.find('#new-question').setValue('What has to be finished by Friday?')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createHabit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Plan the week', kind: 'checklist', slot: 'morning', weekdays: [1],
      question: 'What has to be finished by Friday?',
    }))
  })

  it('defaults to an every-day evening tick', async () => {
    const wrapper = await mountPage()
    await wrapper.find('#new-name').setValue('Read')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createHabit).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'binary', slot: 'evening', weekdays: ALL, question: null,
    }))
  })
})

describe('a habit row at rest', () => {
  it('names the slot and the days when they are not every day', async () => {
    const wrapper = await mountPage()
    const summaries = wrapper.findAll('.habits__summary').map(n => n.text())
    expect(summaries).toContain('4× / week')
    expect(summaries).toContain('morning · Mon · 1× / week')
    expect(summaries).toContain('morning · Mon–Fri · 5× / week')
  })
})

describe('editing a habit’s schedule', () => {
  it('sends a changed slot and leaves unchanged fields out', async () => {
    const wrapper = await mountPage()
    await openEditor(wrapper, 1)
    await wrapper.find('#edit-1-slot').setValue('morning')
    await wrapper.find('[data-save="1"]').trigger('click')
    await flushPromises()

    expect(updateHabit).toHaveBeenCalledWith(1, { name: 'Gym', timesPerWeek: 4, slot: 'morning' })
  })

  it('refuses to save with no days picked', async () => {
    const wrapper = await mountPage()
    await openEditor(wrapper, 5)
    await wrapper.find('#edit-5-days [data-weekday="1"]').trigger('click')
    await wrapper.find('[data-save="5"]').trigger('click')
    await flushPromises()

    expect(updateHabit).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Pick at least one day')
  })
})

describe('editing a checklist’s steps (D-35)', () => {
  it('sends the whole ordered list once, with renames, removals and additions', async () => {
    const wrapper = await mountPage()
    await openEditor(wrapper, 5)

    await wrapper.find('[data-step-label="0"]').setValue('Open PRs > 1 week')
    await wrapper.find('[data-step-remove="1"]').trigger('click')
    await wrapper.find('[data-step-new]').setValue('Decide the target')
    await wrapper.find('[data-step-add]').trigger('click')
    await wrapper.find('[data-step-up="1"]').trigger('click')
    await wrapper.find('[data-save="5"]').trigger('click')
    await flushPromises()

    expect(saveSteps).toHaveBeenCalledTimes(1)
    expect(saveSteps).toHaveBeenCalledWith(5, [
      { label: 'Decide the target' },
      { id: 51, label: 'Open PRs > 1 week' },
    ])
  })

  it('does not touch the steps when they did not change', async () => {
    const wrapper = await mountPage()
    await openEditor(wrapper, 5)
    await wrapper.find('[data-save="5"]').trigger('click')
    await flushPromises()

    expect(saveSteps).not.toHaveBeenCalled()
  })

  it('offers no steps editor for a habit that is not a checklist', async () => {
    const wrapper = await mountPage()
    await openEditor(wrapper, 6)
    expect(wrapper.find('[data-step-new]').exists()).toBe(false)
  })
})
