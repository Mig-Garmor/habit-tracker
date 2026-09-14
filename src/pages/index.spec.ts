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

/**
 * The grid's squares are RouterLinks, and there is no router here. Stubbing it
 * as a real anchor keeps the question this file asks about them — which days
 * link to the log and which do not — answerable from the rendered href.
 */
const RouterLinkStub = {
  props: ['to'],
  computed: {
    href(): string {
      const to = (this as unknown as { to: string | { path: string, query: { date: string } } }).to
      return typeof to === 'string' ? to : `${to.path}?date=${to.query.date}`
    },
  },
  template: '<a :href="href"><slot /></a>',
}

async function mountPage() {
  const IndexPage = (await import('./index.vue')).default
  const wrapper = mount(IndexPage, {
    attachTo: document.body,
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
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

/**
 * The grid now draws past today so today's square sits about two thirds across
 * instead of at the right edge. That makes the two kinds of empty square mean
 * different things, and the difference is not decorative:
 *
 * `server/routes/log.ts` rejects a future day with "Cannot log a future day",
 * and log.vue caps its Next button at today. A future square rendered as a
 * link would therefore walk someone into a page that refuses to save.
 */
describe('the days ahead of today', () => {
  const day = (date: string, future: boolean) =>
    ({ date, completed: false, value: null, note: null, level: 0 as const, future })

  async function mountGrid() {
    return mountWith({
      days: [day('2026-09-12', false), day('2026-09-13', false), day('2026-09-14', true)],
    })
  }

  it('does not link a future day to the log, which would refuse to save it', async () => {
    const wrapper = await mountGrid()
    const hrefs = wrapper.findAll('a').map(a => a.attributes('href'))
    expect(hrefs).toContain('/log?date=2026-09-13')
    expect(hrefs).not.toContain('/log?date=2026-09-14')
  })

  it('still draws the future day, so the grid keeps its full width', async () => {
    const wrapper = await mountGrid()
    expect(wrapper.findAll('.activity-grid__day')).toHaveLength(3)
  })

  it('marks it as future so it does not read as a day that was missed', async () => {
    const wrapper = await mountGrid()
    const squares = wrapper.findAll('.activity-grid__day')
    expect(squares[1]!.classes()).not.toContain('is-future')
    expect(squares[2]!.classes()).toContain('is-future')
  })

  it('says nothing has happened yet, rather than that nothing was logged', async () => {
    const wrapper = await mountGrid()
    const future = wrapper.findAll('.activity-grid__day')[2]!
    expect(future.attributes('title')).toBe('2026-09-14 — still to come')
    expect(future.attributes('title')).not.toContain('nothing logged')
  })
})
