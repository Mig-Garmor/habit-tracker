// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateHabit = vi.fn().mockImplementation((id: number, patch: Record<string, unknown>) =>
  Promise.resolve({
    id, name: patch.name ?? 'Gym', kind: 'binary', unit: null, target: null,
    notesEnabled: false, status: 'active', activatedAt: '2026-09-01',
    createdAt: '2026-09-01T00:00:00.000Z', timesPerWeek: patch.timesPerWeek ?? 4,
  }))

const createHabit = vi.fn().mockResolvedValue({ id: 2, name: 'Gym', timesPerWeek: 4 })

vi.mock('@/lib/api', () => ({
  fetchHabits: () => Promise.resolve([
    {
      id: 1, name: 'Gym', kind: 'binary', unit: null, target: null, notesEnabled: false,
      status: 'active', activatedAt: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z',
      timesPerWeek: 4,
    },
    {
      id: 2, name: 'Code reading', kind: 'quantity', unit: 'minutes', target: 15,
      notesEnabled: false, status: 'active', activatedAt: '2026-09-01',
      createdAt: '2026-09-01T00:00:00.000Z', timesPerWeek: 7,
    },
    {
      id: 3, name: 'Exercise', kind: 'binary', unit: null, target: null,
      notesEnabled: true, status: 'active', activatedAt: '2026-09-01',
      createdAt: '2026-09-01T00:00:00.000Z', timesPerWeek: 4,
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

async function mountPage() {
  const HabitsPage = (await import('./habits.vue')).default
  const wrapper = mount(HabitsPage, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

/** Opens a row's menu and chooses Edit, as a person would. */
async function openEditor(wrapper: Awaited<ReturnType<typeof mountPage>>, id: number) {
  await wrapper.find(`[data-menu="${id}"]`).trigger('click')
  await flushPromises()
  const item = document.querySelector<HTMLElement>(`[data-edit="${id}"]`)
  if (!item) throw new Error(`no Edit item for habit ${id}`)
  item.click()
  await flushPromises()
}

beforeEach(() => {
  updateHabit.mockClear()
  createHabit.mockClear()
  document.body.innerHTML = ''
})

/**
 * A row used to carry every field as a live input at all times, which made it
 * crowded and made its height move as values changed. Reading the list is the
 * common case; editing is occasional, so editing moved behind a click.
 */
describe('a habit row at rest', () => {
  it('shows values as text, with no inputs taking up space', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('[data-cadence="1"]').exists()).toBe(false)
    expect(wrapper.find('[data-name="1"]').exists()).toBe(false)
    expect(wrapper.findAll('.habits__summary').map(n => n.text())).toContain('4× / week')
  })

  it('reads a quantity habit as its target and cadence together', async () => {
    const wrapper = await mountPage()
    expect(wrapper.findAll('.habits__summary').map(n => n.text())).toContain('15 minutes, daily')
  })

  it('calls a cadence of 7 daily, which is what a person calls it', async () => {
    const wrapper = await mountPage()
    const summaries = wrapper.findAll('.habits__summary').map(n => n.text())
    expect(summaries.some(text => text.includes('daily'))).toBe(true)
    expect(summaries.some(text => text.includes('7× / week'))).toBe(false)
  })

  it('truncates a long name and keeps the whole one in the title', async () => {
    const wrapper = await mountPage()
    const names = wrapper.findAll('.habits__name')
    const long = names.find(n => n.text().endsWith('…'))
    expect(long?.text()).toBe('Upload a vi…')
    expect(long?.attributes('title')).toBe('Upload a video')
  })

  it('leaves a short name alone, and offers no pointless tooltip', async () => {
    const wrapper = await mountPage()
    const gym = wrapper.findAll('.habits__name').find(n => n.text() === 'Gym')
    expect(gym).toBeDefined()
    expect(gym?.attributes('title')).toBeUndefined()
  })
})

describe('editing a habit', () => {
  it('reveals the fields only after Edit is chosen', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('[data-cadence="1"]').exists()).toBe(false)

    await openEditor(wrapper, 1)

    expect(wrapper.find<HTMLInputElement>('[data-name="1"]').element.value).toBe('Gym')
    expect(wrapper.find<HTMLInputElement>('[data-cadence="1"]').element.value).toBe('4')
  })

  it('saves the name and cadence together in one request', async () => {
    const wrapper = await mountPage()
    await openEditor(wrapper, 1)

    await wrapper.find('[data-name="1"]').setValue('Gym sessions')
    await wrapper.find('[data-cadence="1"]').setValue('3')
    await wrapper.find('[data-save="1"]').trigger('click')
    await flushPromises()

    // One PATCH, not three: separate requests could half-apply and leave the
    // habit in a state nobody asked for.
    expect(updateHabit).toHaveBeenCalledTimes(1)
    expect(updateHabit).toHaveBeenCalledWith(1, { name: 'Gym sessions', timesPerWeek: 3 })
  })

  it('includes the target for a quantity habit', async () => {
    const wrapper = await mountPage()
    await openEditor(wrapper, 2)

    await wrapper.find('[data-target="2"]').setValue('20')
    await wrapper.find('[data-save="2"]').trigger('click')
    await flushPromises()

    expect(updateHabit).toHaveBeenCalledWith(2, { name: 'Code reading', timesPerWeek: 7, target: 20 })
  })

  it('saves nothing when Cancel is chosen, and puts the row back', async () => {
    const wrapper = await mountPage()
    await openEditor(wrapper, 1)
    await wrapper.find('[data-name="1"]').setValue('Something else')

    await wrapper.findAll('button').find(b => b.text() === 'Cancel')!.trigger('click')
    await flushPromises()

    expect(updateHabit).not.toHaveBeenCalled()
    expect(wrapper.find('[data-name="1"]').exists()).toBe(false)
    expect(wrapper.findAll('.habits__name').map(n => n.text())).toContain('Gym')
  })

  it('refuses an empty name rather than sending one', async () => {
    const wrapper = await mountPage()
    await openEditor(wrapper, 1)
    await wrapper.find('[data-name="1"]').setValue('   ')
    await wrapper.find('[data-save="1"]').trigger('click')
    await flushPromises()

    expect(updateHabit).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('A habit needs a name')
  })

  it('refuses a cadence outside 1-7 rather than letting the server reject it', async () => {
    const wrapper = await mountPage()
    await openEditor(wrapper, 1)
    await wrapper.find('[data-cadence="1"]').setValue('9')
    await wrapper.find('[data-save="1"]').trigger('click')
    await flushPromises()

    expect(updateHabit).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('between 1 and 7')
  })

  it('can be edited from the queue, without activating it first', async () => {
    const wrapper = await mountPage()
    await openEditor(wrapper, 9)

    await wrapper.find('[data-cadence="9"]').setValue('2')
    await wrapper.find('[data-save="9"]').trigger('click')
    await flushPromises()

    expect(updateHabit).toHaveBeenCalledWith(9, { name: 'Upload a video', timesPerWeek: 2 })
  })

  it('only opens one row at a time', async () => {
    const wrapper = await mountPage()
    await openEditor(wrapper, 1)
    await openEditor(wrapper, 2)

    expect(wrapper.find('[data-name="1"]').exists()).toBe(false)
    expect(wrapper.find('[data-name="2"]').exists()).toBe(true)
  })
})

describe('reaching the notes page', () => {
  it('offers Notes only for a habit that carries them', async () => {
    const wrapper = await mountPage()
    // Gym has notesEnabled false in this fixture; a Notes entry there would
    // lead to a page that can only ever be empty.
    await wrapper.find('[data-menu="1"]').trigger('click')
    await flushPromises()
    expect(document.querySelector('[data-notes="1"]')).toBeNull()
  })

  it('offers Notes for a habit that has them enabled', async () => {
    const wrapper = await mountPage()
    await wrapper.find('[data-menu="3"]').trigger('click')
    await flushPromises()
    expect(document.querySelector('[data-notes="3"]')).not.toBeNull()
  })
})

describe('creating a habit', () => {
  it('creates with the chosen cadence', async () => {
    const wrapper = await mountPage()
    await wrapper.find('#new-name').setValue('Swim')
    await wrapper.find('#new-cadence').setValue('2')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createHabit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Swim', timesPerWeek: 2 }))
  })
})
