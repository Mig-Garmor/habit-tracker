// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TodayHabit } from '@/lib/api'
import TodayHabitRow from './TodayHabit.vue'

const saveLog = vi.fn()

vi.mock('@/lib/api', () => ({
  saveLog: (...args: unknown[]) => saveLog(...args),
}))

const DATE = '2026-11-03'

function habit(overrides: Partial<TodayHabit> = {}): TodayHabit {
  return {
    id: 1,
    name: 'Check the team',
    kind: 'binary',
    unit: null,
    target: null,
    notesEnabled: false,
    question: null,
    timesPerWeek: 5,
    steps: [],
    carriedFrom: null,
    progress: 0,
    entry: null,
    ...overrides,
  }
}

function mountRow(overrides: Partial<TodayHabit> = {}) {
  return mount(TodayHabitRow, { props: { habit: habit(overrides), date: DATE }, attachTo: document.body })
}

beforeEach(() => {
  saveLog.mockReset()
  saveLog.mockResolvedValue({ date: DATE, isToday: true, habits: [] })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a tick', () => {
  it('saves just this habit, straight away (D-34)', async () => {
    const wrapper = mountRow()
    await wrapper.find('[role="checkbox"]').trigger('click')
    await flushPromises()

    expect(saveLog).toHaveBeenCalledTimes(1)
    expect(saveLog).toHaveBeenCalledWith(DATE, [{ habitId: 1, completed: true }])
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('puts the tick back and says why when the save fails', async () => {
    saveLog.mockRejectedValueOnce(new Error('Can’t reach the API.'))
    const wrapper = mountRow()
    await wrapper.find('[role="checkbox"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="checkbox"]').attributes('aria-checked')).toBe('false')
    expect(wrapper.text()).toContain('Can’t reach the API.')
    expect(wrapper.emitted('saved')).toBeUndefined()
  })
})

describe('a checklist', () => {
  const steps = [{ id: 11, label: 'Open PRs' }, { id: 12, label: 'Target' }]

  it('sends the whole set of ticked steps when one is ticked', async () => {
    const wrapper = mountRow({ kind: 'checklist', target: 2, steps, entry: { completed: true, value: 1, note: null, steps: [11] } })
    await wrapper.findAll('[role="checkbox"]')[1]!.trigger('click')
    await flushPromises()

    expect(saveLog).toHaveBeenCalledWith(DATE, [{ habitId: 1, steps: [11, 12] }])
  })

  it('shows how many steps are done', () => {
    const wrapper = mountRow({ kind: 'checklist', target: 2, steps, entry: { completed: true, value: 1, note: null, steps: [11] } })
    expect(wrapper.text()).toContain('1/2')
  })

  it('ticks as a whole while it has no steps yet', async () => {
    const wrapper = mountRow({ kind: 'checklist' })
    await wrapper.find('[role="checkbox"]').trigger('click')
    await flushPromises()
    expect(saveLog).toHaveBeenCalledWith(DATE, [{ habitId: 1, completed: true }])
  })
})

describe('a journal (D-32)', () => {
  it('has no tick, only somewhere to write', () => {
    const wrapper = mountRow({ kind: 'journal', notesEnabled: true })
    expect(wrapper.find('[role="checkbox"]').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(true)
  })

  it('saves once, 800 ms after typing stops', async () => {
    const wrapper = mountRow({ kind: 'journal', notesEnabled: true })
    await wrapper.find('textarea').setValue('Reviewed')
    await wrapper.find('textarea').setValue('Reviewed #1576')
    vi.advanceTimersByTime(799)
    expect(saveLog).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(saveLog).toHaveBeenCalledTimes(1)
    expect(saveLog).toHaveBeenCalledWith(DATE, [{ habitId: 1, note: 'Reviewed #1576' }])
  })

  it('saves straight away on blur', async () => {
    const wrapper = mountRow({ kind: 'journal', notesEnabled: true })
    await wrapper.find('textarea').setValue('Shipped it')
    await wrapper.find('textarea').trigger('blur')
    await flushPromises()
    expect(saveLog).toHaveBeenCalledTimes(1)
  })

  it('does not lose what was typed when the page is left mid-sentence', async () => {
    const wrapper = mountRow({ kind: 'journal', notesEnabled: true })
    await wrapper.find('textarea').setValue('Half a tho')
    wrapper.unmount()
    await flushPromises()
    expect(saveLog).toHaveBeenCalledWith(DATE, [{ habitId: 1, note: 'Half a tho' }])
  })

  it('keeps the text and offers a retry when the save fails', async () => {
    saveLog.mockRejectedValueOnce(new Error('offline'))
    const wrapper = mountRow({ kind: 'journal', notesEnabled: true })
    await wrapper.find('textarea').setValue('Keep me')
    await wrapper.find('textarea').trigger('blur')
    await flushPromises()

    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('Keep me')
    expect(wrapper.text()).toContain('Not saved')
    await wrapper.find('[data-retry]').trigger('click')
    await flushPromises()
    expect(saveLog).toHaveBeenCalledTimes(2)
  })
})

describe('what the row says', () => {
  it('shows the question', () => {
    expect(mountRow({ question: 'Is anyone blocked?' }).text()).toContain('Is anyone blocked?')
  })

  it('says which day a carried habit is from (D-31)', () => {
    expect(mountRow({ carriedFrom: '2026-11-02' }).text()).toContain('from Monday')
  })

  it('saves an amount when it changes', async () => {
    const wrapper = mountRow({ kind: 'quantity', unit: 'minutes', target: 15 })
    await wrapper.find('input[type="number"]').setValue('10')
    await wrapper.find('input[type="number"]').trigger('change')
    await flushPromises()
    expect(saveLog).toHaveBeenCalledWith(DATE, [{ habitId: 1, value: 10 }])
  })
})

/** A save the test resolves by hand, to hold a request in flight. */
function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

describe('saves in flight (review I1, I2)', () => {
  const steps = [{ id: 11, label: 'Open PRs' }, { id: 12, label: 'Target' }]

  it('sends quick ticks one after another, each building on the last', async () => {
    const first = deferred()
    saveLog.mockReturnValueOnce(first.promise)
    const wrapper = mountRow({ kind: 'checklist', target: 2, steps })
    const boxes = () => wrapper.findAll('[role="checkbox"]')

    await boxes()[0]!.trigger('click')
    await boxes()[1]!.trigger('click')
    await flushPromises()
    expect(saveLog).toHaveBeenCalledTimes(1)

    first.resolve({})
    await flushPromises()
    expect(saveLog).toHaveBeenNthCalledWith(1, DATE, [{ habitId: 1, steps: [11] }])
    expect(saveLog).toHaveBeenNthCalledWith(2, DATE, [{ habitId: 1, steps: [11, 12] }])
  })

  it('does not let a refetch from before the last save untick anything', async () => {
    const first = deferred()
    saveLog.mockReturnValueOnce(first.promise)
    const wrapper = mountRow({ kind: 'checklist', target: 2, steps })
    await wrapper.findAll('[role="checkbox"]')[0]!.trigger('click')

    await wrapper.setProps({ habit: habit({ kind: 'checklist', target: 2, steps, entry: null }) })
    expect(wrapper.findAll('[role="checkbox"]')[0]!.attributes('aria-checked')).toBe('true')
    first.resolve({})
    await flushPromises()
  })

  it('tells the page only once everything has saved', async () => {
    const first = deferred()
    saveLog.mockReturnValueOnce(first.promise)
    const wrapper = mountRow({ kind: 'checklist', target: 2, steps })
    await wrapper.findAll('[role="checkbox"]')[0]!.trigger('click')
    await wrapper.findAll('[role="checkbox"]')[1]!.trigger('click')
    first.resolve({})
    await flushPromises()

    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('keeps typing that happened while an earlier save was out', async () => {
    const first = deferred()
    saveLog.mockReturnValueOnce(first.promise)
    const wrapper = mountRow({ kind: 'journal', notesEnabled: true })
    await wrapper.find('textarea').setValue('abc')
    vi.advanceTimersByTime(800)
    await wrapper.find('textarea').setValue('abcd')

    first.resolve({})
    await flushPromises()
    await wrapper.setProps({ habit: habit({ kind: 'journal', notesEnabled: true, entry: { completed: true, value: null, note: 'abc' } }) })
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('abcd')

    vi.advanceTimersByTime(800)
    await flushPromises()
    expect(saveLog).toHaveBeenLastCalledWith(DATE, [{ habitId: 1, note: 'abcd' }])
  })

  it('asks the page to reload when a save is refused (review I4)', async () => {
    saveLog.mockRejectedValueOnce(new Error('Step 12 does not belong to habit 1'))
    const wrapper = mountRow({ kind: 'checklist', target: 2, steps })
    await wrapper.findAll('[role="checkbox"]')[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })
})
