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
    timesPerWeek: 7,
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

/**
 * happy-dom gives every element a zeroed rect, so the drag arithmetic has
 * nothing to work with unless rows are given real geometry. 40px rows stacked
 * from y=0.
 */
function giveRowsGeometry(root: Element) {
  root.querySelectorAll('li').forEach((row, index) => {
    row.getBoundingClientRect = () =>
      ({ top: index * 40, height: 40, bottom: index * 40 + 40, left: 0, right: 0, width: 100, x: 0, y: index * 40, toJSON: () => ({}) }) as DOMRect
  })
}

function pointer(type: string, clientY: number, pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId, clientY, clientX: 0, button: 0 })
  return event
}

async function mountPage() {
  const HabitsPage = (await import('./habits.vue')).default
  const wrapper = mount(HabitsPage, {
    // Attached, not detached: the drag looks its list up with
    // document.querySelector, which finds nothing in a detached tree.
    attachTo: document.body,
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

/**
 * The drag path, which is what actually broke in use: on mobile the row stayed
 * stuck to the finger after release and no request was sent. The cause was
 * `setPointerCapture` on the grip — as the list reorders, Vue moves that row's
 * node, the capture is lost, and `pointerup` never arrives. Listeners now live
 * on `window`, so these tests dispatch there.
 */
describe('dragging a habit', () => {
  beforeEach(() => {
    reorderHabits.mockClear()
    document.body.innerHTML = ''
  })

  it('saves the new order when the finger lifts', async () => {
    const wrapper = await mountPage()
    giveRowsGeometry(wrapper.element as Element)

    await wrapper.find('[data-grip="1"]').element.dispatchEvent(pointer('pointerdown', 10))
    window.dispatchEvent(pointer('pointermove', 95)) // past the third row's midpoint
    await flushPromises()
    window.dispatchEvent(pointer('pointerup', 95))
    await flushPromises()

    expect(reorderHabits).toHaveBeenCalledTimes(1)
    expect(reorderHabits).toHaveBeenCalledWith([2, 3, 1])
  })

  it('releases the row when the finger lifts, so it is not left stuck', async () => {
    const wrapper = await mountPage()
    giveRowsGeometry(wrapper.element as Element)

    wrapper.find('[data-grip="1"]').element.dispatchEvent(pointer('pointerdown', 10))
    window.dispatchEvent(pointer('pointermove', 95))
    await flushPromises()
    expect(wrapper.find('.habits__row--dragging').exists()).toBe(true)

    window.dispatchEvent(pointer('pointerup', 95))
    await flushPromises()
    expect(wrapper.find('.habits__row--dragging').exists()).toBe(false)
  })

  it('still saves when the browser cancels the gesture', async () => {
    const wrapper = await mountPage()
    giveRowsGeometry(wrapper.element as Element)

    wrapper.find('[data-grip="1"]').element.dispatchEvent(pointer('pointerdown', 10))
    window.dispatchEvent(pointer('pointermove', 95))
    await flushPromises()
    // iOS reclaims gestures it decides are scrolls; the move must not be lost.
    window.dispatchEvent(pointer('pointercancel', 95))
    await flushPromises()

    expect(reorderHabits).toHaveBeenCalledWith([2, 3, 1])
    expect(wrapper.find('.habits__row--dragging').exists()).toBe(false)
  })

  it('ignores a second finger during a drag', async () => {
    const wrapper = await mountPage()
    giveRowsGeometry(wrapper.element as Element)

    wrapper.find('[data-grip="1"]').element.dispatchEvent(pointer('pointerdown', 10, 1))
    wrapper.find('[data-grip="2"]').element.dispatchEvent(pointer('pointerdown', 50, 2))
    window.dispatchEvent(pointer('pointermove', 95, 2)) // the wrong pointer
    await flushPromises()
    window.dispatchEvent(pointer('pointerup', 95, 1))
    await flushPromises()

    // The second finger moved nothing, so the first drag ended where it began.
    expect(reorderHabits).not.toHaveBeenCalled()
    expect(wrapper.find('.habits__row--dragging').exists()).toBe(false)
  })

  it('stops listening once the drag ends', async () => {
    const wrapper = await mountPage()
    giveRowsGeometry(wrapper.element as Element)

    wrapper.find('[data-grip="1"]').element.dispatchEvent(pointer('pointerdown', 10))
    window.dispatchEvent(pointer('pointerup', 10))
    await flushPromises()
    reorderHabits.mockClear()

    // A stray move after release must not drag anything.
    window.dispatchEvent(pointer('pointermove', 95))
    window.dispatchEvent(pointer('pointerup', 95))
    await flushPromises()
    expect(reorderHabits).not.toHaveBeenCalled()
  })
})
