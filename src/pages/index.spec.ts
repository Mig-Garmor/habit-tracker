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

describe('dashboard streak label', () => {
  it('renders the plural "week streak" for a streak of 8', async () => {
    dashboard = { today: '2026-09-13', from: '2026-09-07', habits: [habit({ streak: 8 })], warnings: [] }
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('8 week streak')
    expect(wrapper.text()).not.toContain('day streak')
  })

  it('renders the singular "1 week streak" for a streak of 1', async () => {
    dashboard = { today: '2026-09-13', from: '2026-09-07', habits: [habit({ streak: 1 })], warnings: [] }
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('1 week streak')
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
