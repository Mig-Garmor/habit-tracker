import { describe, expect, it } from 'vitest'
import { buildDashboard } from './dashboard.js'

const TODAY = '2026-09-12'
const FROM = '2026-09-07'

const exercise = {
  id: 1, name: 'Exercise', kind: 'binary' as const, unit: null,
  target: null, notesEnabled: true, activatedAt: '2026-01-01',
}

const meditation = {
  id: 2, name: 'Meditation', kind: 'quantity' as const, unit: 'minutes',
  target: 10, notesEnabled: false, activatedAt: '2026-01-01',
}

function entry(habitId: number, date: string, value: number | null, note: string | null = null) {
  return { habitId, date, completed: value === null ? true : value > 0, value, note }
}

describe('buildDashboard', () => {
  it('returns a dense day per date in the range, entry or not', () => {
    const result = buildDashboard([exercise], [entry(1, '2026-09-09', null)], FROM, TODAY)
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
    )
    const levels = Object.fromEntries(result.habits[0]!.days.map(d => [d.date, d.level]))
    expect(levels['2026-09-07']).toBe(0)
    expect(levels['2026-09-08']).toBe(1)
    expect(levels['2026-09-09']).toBe(3)
    expect(levels['2026-09-10']).toBe(4)
  })

  it('carries value and note through to the day', () => {
    const result = buildDashboard([exercise], [entry(1, '2026-09-09', null, 'squats, 5k')], FROM, TODAY)
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
    )
    expect(result.habits[0]!.days.filter(d => d.completed).map(d => d.date)).toEqual(['2026-09-09'])
    expect(result.habits[1]!.days.filter(d => d.completed).map(d => d.date)).toEqual(['2026-09-10'])
  })

  it('computes a streak that tolerates an unlogged today', () => {
    const result = buildDashboard(
      [exercise],
      [entry(1, '2026-09-10', null), entry(1, '2026-09-11', null)],
      FROM,
      TODAY,
    )
    expect(result.habits[0]!.streak).toBe(2)
  })

  it('echoes the range it was given', () => {
    const result = buildDashboard([exercise], [], FROM, TODAY)
    expect(result.today).toBe(TODAY)
    expect(result.from).toBe(FROM)
  })

  it('warns only about struggling habits', () => {
    const result = buildDashboard([exercise, meditation], [], FROM, TODAY)
    expect(result.habits.map(h => h.health)).toEqual(['struggling', 'struggling'])
    expect(result.warnings.map(w => w.habitId)).toEqual([1, 2])
  })

  it('does not warn about a habit inside its grace period', () => {
    const fresh = { ...exercise, activatedAt: TODAY }
    const result = buildDashboard([fresh], [], FROM, TODAY)
    expect(result.habits[0]!.health).toBe('new')
    expect(result.warnings).toEqual([])
  })

  it('handles a habit with no entries at all', () => {
    const result = buildDashboard([exercise], [], FROM, TODAY)
    expect(result.habits[0]!.streak).toBe(0)
    expect(result.habits[0]!.rate).toBe(0)
    expect(result.habits[0]!.days.every(d => d.level === 0)).toBe(true)
  })
})
