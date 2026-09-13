// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Habit } from '@/lib/api'

/**
 * Moving a habit has to reach the database. The API route is covered
 * separately; what is covered here is the half that has bitten us twice —
 * a control that looks right on screen and never calls the API at all.
 *
 * The drag gesture itself cannot be simulated meaningfully here, because
 * happy-dom reports every `getBoundingClientRect()` as zeroes, so pointer
 * arithmetic has nothing to work with. The keyboard path is exercised
 * instead: it funnels through the same `commitOrder`, so this pins the
 * request-is-sent contract for both.
 */

function habit(id: number, name: string): Habit {
  return {
    id,
    name,
    kind: 'binary',
    unit: null,
    target: null,
    notesEnabled: false,
    status: 'active',
    activatedAt: '2026-09-01',
    createdAt: '2026-09-01T00:00:00.000Z',
  }
}

const habits = [habit(1, 'Exercise'), habit(2, 'Meditation'), habit(3, 'Read')]

const reorderHabits = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/api', () => ({
  fetchHabits: () => Promise.resolve(habits),
  fetchDashboard: () => Promise.resolve({ habits: [] }),
  createHabit: vi.fn(),
  updateHabit: vi.fn(),
  reorderHabits: (ids: number[]) => reorderHabits(ids),
}))

async function mountPage() {
  const HabitsPage = (await import('./habits.vue')).default
  const wrapper = mount(HabitsPage, {
    global: { stubs: { AlertDialog: true, AlertDialogContent: true } },
  })
  await flushPromises()
  return wrapper
}

describe('reordering a habit', () => {
  beforeEach(() => {
    reorderHabits.mockClear()
  })

  it('sends the new order to the server when a habit is moved', async () => {
    const wrapper = await mountPage()
    const grips = wrapper.findAll('[data-grip]')
    expect(grips.length).toBe(3)

    await grips[0]!.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()

    expect(reorderHabits).toHaveBeenCalledTimes(1)
    expect(reorderHabits).toHaveBeenCalledWith([2, 1, 3])
  })

  it('sends the order again when the habit is moved a second time', async () => {
    const wrapper = await mountPage()
    const grips = wrapper.findAll('[data-grip]')

    await grips[0]!.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    // The moved habit is now second; move it down once more.
    await wrapper.find('[data-grip="1"]').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()

    expect(reorderHabits).toHaveBeenCalledTimes(2)
    expect(reorderHabits).toHaveBeenLastCalledWith([2, 3, 1])
  })

  it('sends nothing when the habit cannot move any further', async () => {
    const wrapper = await mountPage()

    await wrapper.find('[data-grip="1"]').trigger('keydown', { key: 'ArrowUp' })
    await flushPromises()

    // Already first — no move, so no request. A no-op write would still be
    // correct, but it would mean every arrow press at a boundary hits the API.
    expect(reorderHabits).not.toHaveBeenCalled()
  })

  it('puts the habit back if the request fails', async () => {
    reorderHabits.mockRejectedValueOnce(new Error('Network down'))
    const wrapper = await mountPage()

    await wrapper.find('[data-grip="1"]').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()

    // The screen must not keep showing an order the database never accepted.
    const names = wrapper.findAll('.habits__name').map(node => node.text())
    expect(names.slice(0, 3)).toEqual(['Exercise', 'Meditation', 'Read'])
    expect(wrapper.text()).toContain('Network down')
  })
})
