import { describe, expect, it } from 'vitest'
import { buildDashboard, dashboardRange, FUTURE_WEEKS } from './dashboard.js'
import { endOfWeek, startOfWeek, weekStartsInRange } from './date.js'

const TODAY = '2026-09-12'
const FROM = '2026-09-07'

const exercise = {
  id: 1, name: 'Exercise', kind: 'binary' as const, unit: null,
  target: null, notesEnabled: true, activatedAt: '2026-01-01', timesPerWeek: 7,
}

const meditation = {
  id: 2, name: 'Meditation', kind: 'quantity' as const, unit: 'minutes',
  target: 10, notesEnabled: false, activatedAt: '2026-01-01', timesPerWeek: 7,
}

function entry(habitId: number, date: string, value: number | null, note: string | null = null) {
  return { habitId, date, completed: value === null ? true : value > 0, value, note }
}

describe('buildDashboard', () => {
  it('returns a dense day per date in the range, entry or not', () => {
    const result = buildDashboard([exercise], [entry(1, '2026-09-09', null)], FROM, TODAY, TODAY)
    expect(result.habits[0]!.days.map(d => d.date)).toEqual([
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12',
    ])
  })

  it('shades each day from its entry', () => {
    const result = buildDashboard(
      [meditation],
      [entry(2, '2026-09-08', 4), entry(2, '2026-09-09', 10), entry(2, '2026-09-10', 20)],
      FROM,
      TODAY,
      TODAY,
    )
    const levels = Object.fromEntries(result.habits[0]!.days.map(d => [d.date, d.level]))
    expect(levels['2026-09-07']).toBe(0)
    expect(levels['2026-09-08']).toBe(1)
    expect(levels['2026-09-09']).toBe(3)
    expect(levels['2026-09-10']).toBe(4)
  })

  it('carries value and note through to the day', () => {
    const result = buildDashboard([exercise], [entry(1, '2026-09-09', null, 'squats, 5k')], FROM, TODAY, TODAY)
    const day = result.habits[0]!.days.find(d => d.date === '2026-09-09')!
    expect(day.note).toBe('squats, 5k')
    expect(day.completed).toBe(true)
  })

  it('keeps each habit to its own entries', () => {
    const result = buildDashboard(
      [exercise, meditation],
      [entry(1, '2026-09-09', null), entry(2, '2026-09-10', 10)],
      FROM,
      TODAY,
      TODAY,
    )
    expect(result.habits[0]!.days.filter(d => d.completed).map(d => d.date)).toEqual(['2026-09-09'])
    expect(result.habits[1]!.days.filter(d => d.completed).map(d => d.date)).toEqual(['2026-09-10'])
  })

  // D-25 changed what a streak counts: consecutive WEEKS that met cadence,
  // not consecutive days. Exercise is cadence 7, so two days inside the
  // current week is 2 of 7 — the week has not been met, and a week that has
  // not been met yet does not itself break the streak; there is simply no
  // earlier met week behind it.
  it('does not count a part-finished week toward the streak', () => {
    const result = buildDashboard(
      [exercise],
      [entry(1, '2026-09-10', null), entry(1, '2026-09-11', null)],
      FROM,
      TODAY,
      TODAY,
    )
    expect(result.habits[0]!.streak).toBe(0)
  })

  it('echoes the range it was given', () => {
    const result = buildDashboard([exercise], [], FROM, TODAY, TODAY)
    expect(result.today).toBe(TODAY)
    expect(result.from).toBe(FROM)
  })

  it('warns only about struggling habits', () => {
    const result = buildDashboard([exercise, meditation], [], FROM, TODAY, TODAY)
    expect(result.habits.map(h => h.health)).toEqual(['struggling', 'struggling'])
    expect(result.warnings.map(w => w.habitId)).toEqual([1, 2])
  })

  it('does not warn about a habit inside its grace period', () => {
    const fresh = { ...exercise, activatedAt: TODAY }
    const result = buildDashboard([fresh], [], FROM, TODAY, TODAY)
    expect(result.habits[0]!.health).toBe('new')
    expect(result.warnings).toEqual([])
  })

  it('handles a habit with no entries at all', () => {
    const result = buildDashboard([exercise], [], FROM, TODAY, TODAY)
    expect(result.habits[0]!.streak).toBe(0)
    expect(result.habits[0]!.rate).toBe(0)
    expect(result.habits[0]!.days.every(d => d.level === 0)).toBe(true)
  })

  // Item 5 of the final-fixes brief: `weeks` must cover the whole rendered
  // range, not just the (much shorter) scoring window — otherwise a habit
  // kept for a year only shows the cadence marker on its newest few columns,
  // which reads as "the rest failed" (D-23).
  describe('weeks span the rendered range, not the scoring window', () => {
    // 14 weeks before 2026-09-07 (TODAY's Monday), so a 15-week range.
    const WIDE_FROM = '2026-06-01'

    it('reports one week summary per week in a 15-week range', () => {
      const result = buildDashboard([exercise], [], WIDE_FROM, TODAY, TODAY)
      expect(result.habits[0]!.weeks).toHaveLength(15)
    })

    it('still reports met: true for a week the scoring window has aged out', () => {
      // 2026-06-01..2026-06-07 is the oldest week in the range and, at
      // cadence 7, is well outside the 5-week scoring window around TODAY
      // (2026-09-12) — it cannot affect completionRate or health, but the
      // grid still needs to know it was met.
      const oldWeekEntries = [
        '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04',
        '2026-06-05', '2026-06-06', '2026-06-07',
      ].map(date => entry(1, date, null))
      const result = buildDashboard([exercise], oldWeekEntries, WIDE_FROM, TODAY, TODAY)
      const oldWeek = result.habits[0]!.weeks.find(w => w.start === WIDE_FROM)!
      expect(oldWeek.met).toBe(true)
    })
  })
})

/**
 * The grid used to stop at today, which pinned today's square to the very last
 * column and left no sense of the week ahead. The rendered range now runs past
 * today to the end of a future week.
 *
 * The distinction this suite defends: `to` moves the DRAWING, `today` still
 * anchors the SCORING. A future day is empty because it has not happened, not
 * because it was missed, and nothing about streak, rate or health may shift
 * just because the grid got longer.
 */
describe('a range drawn past today', () => {
  // TODAY is 2026-09-12 (a Saturday), so its week starts 2026-09-07. This runs
  // to the Sunday closing the week two after it: three whole columns.
  const TO = '2026-09-27'

  it('draws a day for every date through the range end, not just today', () => {
    const result = buildDashboard([exercise], [], FROM, TODAY, TO)
    const days = result.habits[0]!.days
    expect(days).toHaveLength(21)
    expect(days[0]!.date).toBe('2026-09-07')
    expect(days.at(-1)!.date).toBe('2026-09-27')
  })

  it('marks every date after today as future, and today itself as not', () => {
    const result = buildDashboard([exercise], [], FROM, TODAY, TO)
    const byDate = new Map(result.habits[0]!.days.map(d => [d.date, d.future]))
    expect(byDate.get('2026-09-11')).toBe(false)
    expect(byDate.get('2026-09-12')).toBe(false) // today is not the future
    expect(byDate.get('2026-09-13')).toBe(true)
    expect(byDate.get('2026-09-27')).toBe(true)
  })

  it('leaves streak, rate and health exactly where a today-ended range put them', () => {
    // The regression that would matter most: lengthening the grid must not
    // dilute a score by adding weeks that were never lived through.
    const entries = [entry(1, '2026-09-08', null), entry(1, '2026-09-09', null)]
    const short = buildDashboard([exercise], entries, FROM, TODAY, TODAY).habits[0]!
    const long = buildDashboard([exercise], entries, FROM, TODAY, TO).habits[0]!

    expect(long.streak).toBe(short.streak)
    expect(long.rate).toBe(short.rate)
    expect(long.health).toBe(short.health)
  })

  it('summarises the future weeks too, but never marks one met', () => {
    const result = buildDashboard([exercise], [], FROM, TODAY, TO)
    const weeks = result.habits[0]!.weeks
    expect(weeks.map(w => w.start)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21'])
    // A future column carrying a cadence marker would claim a week was kept
    // before it happened.
    expect(weeks.filter(w => w.met)).toEqual([])
  })

  it('leaves a future day empty rather than logged', () => {
    const result = buildDashboard([exercise], [], FROM, TODAY, TO)
    const future = result.habits[0]!.days.find(d => d.date === '2026-09-20')!
    expect(future.completed).toBe(false)
    expect(future.level).toBe(0)
    expect(future.note).toBeNull()
  })
})

/**
 * Where today's square actually lands. The grid used to end at today, so today
 * was always the rightmost column and the week ahead was invisible. The total
 * column count is deliberately unchanged — widening the grid instead would
 * squeeze the text column on a 375px phone, which is the density the dashboard
 * was compacted for in the first place.
 */
describe('dashboardRange', () => {
  const columns = (from: string, to: string) => weekStartsInRange(from, to)

  it('keeps the requested number of columns, counting the future ones', () => {
    const { from, to } = dashboardRange(TODAY, 15)
    expect(columns(from, to)).toHaveLength(15)
  })

  it('puts today two thirds of the way across rather than at the end', () => {
    const { from, to } = dashboardRange(TODAY, 15)
    const weeks = columns(from, to)
    // Column 10 of 15. The point of the whole change.
    expect(weeks.indexOf(startOfWeek(TODAY))).toBe(9)
  })

  it('ends on a Sunday, so the last column is a whole week', () => {
    const { to } = dashboardRange(TODAY, 15)
    expect(to).toBe(endOfWeek(to))
    expect(to > TODAY).toBe(true)
  })

  it('starts on a Monday, so the first column is a whole week too', () => {
    const { from } = dashboardRange(TODAY, 15)
    expect(from).toBe(startOfWeek(from))
  })

  it('still shows a week of history when asked for fewer weeks than it draws ahead', () => {
    // Without the floor this asks for zero or negative past weeks and the
    // range inverts, emptying the grid outright.
    const { from, to } = dashboardRange(TODAY, 1)
    expect(from).toBe(startOfWeek(TODAY))
    expect(columns(from, to)).toHaveLength(1 + FUTURE_WEEKS)
  })

  it('scales the history, not the runway, when asked for more weeks', () => {
    const { from, to } = dashboardRange(TODAY, 53)
    const weeks = columns(from, to)
    expect(weeks).toHaveLength(53)
    expect(weeks.length - 1 - weeks.indexOf(startOfWeek(TODAY))).toBe(FUTURE_WEEKS)
  })
})
