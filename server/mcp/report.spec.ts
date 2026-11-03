import { describe, expect, it } from 'vitest'
import type { TodayHabit, TodayResponse } from '../lib/today.js'
import { buildReport, renderReport } from './report.js'

function habit(overrides: Partial<TodayHabit>): TodayHabit {
  return {
    id: 1, name: 'x', kind: 'binary', unit: null, target: null, notesEnabled: false, question: null,
    timesPerWeek: 5, steps: [], carriedFrom: null, progress: 0, entry: null, ...overrides,
  }
}

const TODAY: TodayResponse = {
  date: '2026-11-03',
  weekday: 2,
  morningVisible: true,
  slots: {
    morning: {
      habits: [
        habit({
          id: 1, name: 'Plan the week', kind: 'checklist', target: 5, carriedFrom: '2026-11-02', progress: 0.4,
          steps: [1, 2, 3, 4, 5].map(id => ({ id, label: `s${id}` })),
          entry: { completed: true, value: 2, note: null, steps: [1, 2] },
        }),
        habit({ id: 2, name: 'Recap team initiatives', kind: 'journal', progress: 1, entry: { completed: true, value: null, note: 'Hydra v4 merged' } }),
        habit({ id: 3, name: 'What did I do today', kind: 'journal' }),
      ],
      progress: 0.4667, done: 2, total: 3,
    },
    evening: {
      habits: [
        habit({ id: 4, name: 'Code reading', kind: 'quantity', unit: 'minutes', target: 15, progress: 0.67, entry: { completed: true, value: 10, note: null } }),
        habit({ id: 5, name: 'Exercise', progress: 1, entry: { completed: true, value: null, note: '5k' } }),
      ],
      progress: 0.83, done: 2, total: 2,
    },
  },
}

const OBJECTIVES = { date: '2026-11-02', note: 'Ship the Today view; review two PRs', stale: false }

describe('the daily report', () => {
  it('describes each habit the same way every day', () => {
    const report = buildReport(TODAY, OBJECTIVES)
    expect(report.slots.morning!.items).toEqual([
      { habit: 'Plan the week', status: '2 of 5 steps', done: true, carriedFrom: '2026-11-02' },
      { habit: 'Recap team initiatives', status: 'done', done: true, carriedFrom: null },
      { habit: 'What did I do today', status: 'not yet', done: false, carriedFrom: null },
    ])
    expect(report.slots.evening!.items[0]).toEqual({ habit: 'Code reading', status: '10 of 15 minutes', done: true, carriedFrom: null })
    expect(report.notes).toEqual([
      { habit: 'Recap team initiatives', note: 'Hydra v4 merged' },
      { habit: 'Exercise', note: '5k' },
    ])
  })

  it('renders as fixed text', () => {
    expect(renderReport(buildReport(TODAY, OBJECTIVES))).toBe([
      '# Daily report — Tuesday 2026-11-03',
      '',
      '## Morning — 2 of 3 done (47%)',
      '- [x] Plan the week — 2 of 5 steps (carried from Monday)',
      '- [x] Recap team initiatives — done',
      '- [ ] What did I do today — not yet',
      '',
      '## Evening — 2 of 2 done (83%)',
      '- [x] Code reading — 10 of 15 minutes',
      '- [x] Exercise — done',
      '',
      '## This week\'s objectives (set Monday 2026-11-02)',
      'Ship the Today view; review two PRs',
      '',
      '## Notes today',
      '- Recap team initiatives: Hydra v4 merged',
      '- Exercise: 5k',
    ].join('\n'))
  })

  it('says when there are no objectives, or only last week’s', () => {
    expect(renderReport(buildReport(TODAY, null))).toContain('## This week\'s objectives\nNone written yet.')
    expect(renderReport(buildReport(TODAY, { ...OBJECTIVES, date: '2026-10-26', stale: true })))
      .toContain('## This week\'s objectives (none this week — last set Monday 2026-10-26)')
  })

  it('leaves the morning out at the weekend', () => {
    const weekend = { ...TODAY, date: '2026-11-07', weekday: 6, morningVisible: false }
    expect(renderReport(buildReport(weekend, null))).not.toContain('## Morning')
  })
})
