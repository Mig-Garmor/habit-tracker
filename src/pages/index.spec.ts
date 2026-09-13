// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { DashboardHabit, DashboardResponse, DashboardWarning } from '@/lib/api'

/**
 * D-25 made `currentStreak` count consecutive WEEKS, not days. index.vue's
 * `streakLabel` and its warning banner were leftover from the day model
 * (final-fixes-brief items 1 and 2) — this pins the corrected wording so a
 * regression back to "day" reads as a failing test, not just a stale UI.
 */

function habit(overrides: Partial<DashboardHabit> = {}): DashboardHabit {
  return {
    id: 1,
    name: 'Exercise',
    kind: 'binary',
    unit: null,
    target: null,
    notesEnabled: false,
    activatedAt: '2026-01-01',
    timesPerWeek: 4,
    health: 'steady',
    streak: 8,
    rate: 0.7,
    days: [],
    weeks: [],
    ...overrides,
  }
}

function warning(overrides: Partial<DashboardWarning> = {}): DashboardWarning {
  return { habitId: 1, name: 'Exercise', rate: 0.42, ...overrides }
}

let dashboard: DashboardResponse

vi.mock('@/lib/api', () => ({
  fetchDashboard: () => Promise.resolve(dashboard),
  updateHabit: vi.fn(),
}))

async function mountPage() {
  const IndexPage = (await import('./index.vue')).default
  const wrapper = mount(IndexPage, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

/** Mounts a dashboard holding one habit with the given fields. */
async function mountWith(overrides: Partial<DashboardHabit>) {
  dashboard = { today: '2026-09-13', from: '2026-09-07', habits: [habit(overrides)], warnings: [] }
  return mountPage()
}

describe('dashboard streak label', () => {
  // The wording shortened to fit a phone, but the unit is what this guards:
  // currentStreak returns WEEKS, and the dashboard once printed them as days.
  it('reports a streak of 8 in weeks, not days', async () => {
    dashboard = { today: '2026-09-13', from: '2026-09-07', habits: [habit({ streak: 8 })], warnings: [] }
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('8w streak')
    expect(wrapper.text()).not.toContain('day streak')
  })

  it('reports a streak of 1 in weeks too', async () => {
    dashboard = { today: '2026-09-13', from: '2026-09-07', habits: [habit({ streak: 1 })], warnings: [] }
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('1w streak')
    expect(wrapper.text()).not.toContain('day streak')
  })
})

describe('dashboard warning banner', () => {
  it('describes the rate as recent weeks, not a fourteen-day window', async () => {
    dashboard = {
      today: '2026-09-13',
      from: '2026-09-07',
      habits: [habit({ health: 'struggling', rate: 0.42 })],
      warnings: [warning({ rate: 0.42 })],
    }
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('42% of recent weeks')
    expect(wrapper.text()).not.toContain('14 days')
  })
})

/**
 * The dashboard exists to be glanced at. Six habits used to take three screens
 * because each was a card with a stacked header and a 112px grid; the point of
 * the compact row is that consistency can be read in one look.
 */
describe('the compact habit row', () => {
  it('states cadence and streak on one line, short enough for a phone', async () => {
    const wrapper = await mountWith({ timesPerWeek: 4, streak: 3 })
    const facts = wrapper.find('.dashboard__habit-facts').text()
    expect(facts).toContain('4×/wk')
    expect(facts).toContain('3w streak')
    // The long forms do not fit beside a name and a health pill at 375px.
    expect(facts).not.toContain('4× a week')
    expect(facts).not.toContain('week streak · ')
  })

  it('calls a cadence of 7 daily rather than 7×/wk', async () => {
    const wrapper = await mountWith({ timesPerWeek: 7, streak: 0 })
    expect(wrapper.find('.dashboard__habit-facts').text()).toContain('daily')
  })

  it('shows the target on its own line, now that the text stacks', async () => {
    // It used to be hidden on narrow screens because the one-line layout could
    // not hold it. Stacking beside the grid uses the empty column to the
    // grid's right, so there is room and nothing has to be dropped.
    const wrapper = await mountWith({ kind: 'quantity', target: 15, unit: 'minutes', timesPerWeek: 7, streak: 0 })
    const lines = wrapper.findAll('.dashboard__habit-facts').map(n => n.text())
    expect(lines.some(line => line.includes('15 minutes'))).toBe(true)
  })

  it('shows no target line for a binary habit', async () => {
    const wrapper = await mountWith({ kind: 'binary', timesPerWeek: 4, streak: 0 })
    const lines = wrapper.findAll('.dashboard__habit-facts').map(n => n.text())
    expect(lines.some(line => line.includes('target'))).toBe(false)
  })

  it('truncates a long name and keeps the whole one in the title', async () => {
    const wrapper = await mountWith({ name: 'Record one video', timesPerWeek: 1, streak: 0 })
    const name = wrapper.find('.dashboard__habit-name')
    expect(name.text()).toBe('Record one…')
    expect(name.attributes('title')).toBe('Record one video')
  })
})
