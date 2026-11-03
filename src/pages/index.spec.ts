// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TodayHabit, TodayResponse, TodaySlot } from '@/lib/api'

const fetchToday = vi.fn()

vi.mock('@/lib/api', () => ({
  fetchToday: (date: string) => fetchToday(date),
  saveLog: vi.fn().mockResolvedValue({}),
}))

function habit(id: number, name: string, done = false): TodayHabit {
  return {
    id, name, kind: 'binary', unit: null, target: null, notesEnabled: false, question: null,
    timesPerWeek: 5, steps: [], carriedFrom: null, progress: done ? 1 : 0,
    entry: done ? { completed: true, value: null, note: null } : null,
  }
}

function slot(habits: TodayHabit[]): TodaySlot {
  const done = habits.filter(h => h.entry?.completed).length
  return { habits, progress: habits.length ? done / habits.length : 0, done, total: habits.length }
}

function day(date: string, morningVisible = true): TodayResponse {
  return {
    date,
    weekday: 2,
    morningVisible,
    slots: {
      morning: slot(morningVisible ? [habit(1, 'Plan the week'), habit(2, 'Check the team', true)] : []),
      evening: slot([habit(3, 'Exercise', true), habit(4, 'Meditation'), habit(5, 'Read')]),
    },
  }
}

async function mountAt(when: Date) {
  vi.setSystemTime(when)
  const Page = (await import('./index.vue')).default
  const wrapper = mount(Page, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

const expandedNames = (wrapper: Awaited<ReturnType<typeof mountAt>>) =>
  wrapper.findAll('.today__slot--front .today-habit__name').map(n => n.text())

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  fetchToday.mockReset()
  fetchToday.mockImplementation((date: string) => Promise.resolve(day(date, !['2026-11-07', '2026-11-08'].includes(date))))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the Today view (D-29)', () => {
  it('opens on the morning during a working day, with the evening folded into its bar', async () => {
    const wrapper = await mountAt(new Date(2026, 10, 3, 9, 0))

    expect(fetchToday).toHaveBeenCalledWith('2026-11-03')
    expect(expandedNames(wrapper)).toEqual(['Plan the week', 'Check the team'])
    const bar = wrapper.find('[data-slot-bar="evening"]')
    expect(bar.text()).toContain('Evening')
    expect(bar.text()).toContain('1 of 3 done')
    expect(bar.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('33')
  })

  it('turns round at five', async () => {
    const wrapper = await mountAt(new Date(2026, 10, 3, 18, 0))

    expect(expandedNames(wrapper)).toEqual(['Exercise', 'Meditation', 'Read'])
    expect(wrapper.find('[data-slot-bar="morning"]').text()).toContain('1 of 2 done')
  })

  it('has no morning bar at all at the weekend', async () => {
    const wrapper = await mountAt(new Date(2026, 10, 7, 9, 0))

    expect(expandedNames(wrapper)).toEqual(['Exercise', 'Meditation', 'Read'])
    expect(wrapper.find('[data-slot-bar="morning"]').exists()).toBe(false)
  })

  it('brings a folded slot forward when its bar is pressed', async () => {
    const wrapper = await mountAt(new Date(2026, 10, 3, 9, 0))
    await wrapper.find('[data-slot-bar="evening"]').trigger('click')

    expect(expandedNames(wrapper)).toEqual(['Exercise', 'Meditation', 'Read'])
    expect(wrapper.find('[data-slot-bar="morning"]').exists()).toBe(true)
  })

  it('hands back to the clock at the next switch', async () => {
    const wrapper = await mountAt(new Date(2026, 10, 3, 16, 59))
    await wrapper.find('[data-slot-bar="evening"]').trigger('click')
    await wrapper.find('[data-slot-bar="morning"]').trigger('click')
    expect(expandedNames(wrapper)).toEqual(['Plan the week', 'Check the team'])

    vi.advanceTimersByTime(60_000)
    await flushPromises()
    expect(expandedNames(wrapper)).toEqual(['Exercise', 'Meditation', 'Read'])
  })

  it('moves on to the new day when left open past midnight', async () => {
    await mountAt(new Date(2026, 10, 3, 23, 59, 30))
    vi.advanceTimersByTime(60_000)
    await flushPromises()

    expect(fetchToday).toHaveBeenLastCalledWith('2026-11-04')
  })

  it('refreshes the bars after a habit saves', async () => {
    const wrapper = await mountAt(new Date(2026, 10, 3, 9, 0))
    fetchToday.mockClear()
    wrapper.findComponent({ name: 'TodayHabit' }).vm.$emit('saved')
    await flushPromises()

    expect(fetchToday).toHaveBeenCalledWith('2026-11-03')
  })
})

describe('keeping the page current', () => {
  it('shows the newest answer when two reloads finish out of order (review I1)', async () => {
    const wrapper = await mountAt(new Date(2026, 10, 3, 9, 0))
    const slow = deferred<TodayResponse>()
    const fast = deferred<TodayResponse>()
    fetchToday.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)

    const row = wrapper.findComponent({ name: 'TodayHabit' })
    row.vm.$emit('saved')
    row.vm.$emit('saved')
    const newer = day('2026-11-03')
    newer.slots.morning.habits[0]!.name = 'Newest'
    fast.resolve(newer)
    await flushPromises()
    slow.resolve(day('2026-11-03'))
    await flushPromises()

    expect(expandedNames(wrapper)[0]).toBe('Newest')
  })

  it('keeps trying the new day if the server refused it at midnight (review I3)', async () => {
    await mountAt(new Date(2026, 10, 3, 23, 59, 30))
    fetchToday.mockRejectedValueOnce(new Error('Cannot log a future day'))
    vi.advanceTimersByTime(60_000)
    await flushPromises()
    expect(fetchToday).toHaveBeenLastCalledWith('2026-11-04')

    fetchToday.mockClear()
    vi.advanceTimersByTime(60_000)
    await flushPromises()
    expect(fetchToday).toHaveBeenCalledWith('2026-11-04')
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
