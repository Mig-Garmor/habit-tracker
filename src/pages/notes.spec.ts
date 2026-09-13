// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HabitNotesResponse } from '@/lib/api'

/**
 * Notes were writable but not readable: the only way to see one was to open
 * the exact day that carried it, and nothing hinted which days those were.
 * This page is the reading half.
 */

let response: HabitNotesResponse
const fetchHabitNotes = vi.fn((_id: number) => Promise.resolve(response))

vi.mock('@/lib/api', () => ({
  fetchHabitNotes: (id: number) => fetchHabitNotes(id),
}))

let query: Record<string, string> = { habit: '1' }

vi.mock('vue-router', () => ({
  useRoute: () => ({ query }),
  RouterLink: { props: ['to'], template: '<a :href="String(to.path ?? to)"><slot /></a>' },
}))

async function mountPage() {
  const NotesPage = (await import('./notes.vue')).default
  const wrapper = mount(NotesPage, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  fetchHabitNotes.mockClear()
  query = { habit: '1' }
  document.body.innerHTML = ''
  response = {
    habit: { id: 1, name: 'Exercise' },
    notes: [
      { date: '2026-09-10', note: 'legs, 40 minutes', completed: true, value: null },
      { date: '2026-09-05', note: 'swim\nfelt easy', completed: true, value: null },
    ],
  }
})

describe('the notes page', () => {
  it('asks for the habit named in the query', async () => {
    query = { habit: '7' }
    await mountPage()
    expect(fetchHabitNotes).toHaveBeenCalledWith(7)
  })

  it('names the habit it is showing', async () => {
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('Exercise')
  })

  it('lists notes in the order the server gave them, newest first', async () => {
    // The page must not re-sort: the server orders by date, and a second
    // opinion here is a second thing that can disagree.
    const wrapper = await mountPage()
    const texts = wrapper.findAll('.notes__text').map(n => n.text())
    expect(texts).toEqual(['legs, 40 minutes', 'swim\nfelt easy'])
  })

  it('links each note to the day it belongs to', async () => {
    const wrapper = await mountPage()
    expect(wrapper.findAll('.notes__date').length).toBe(2)
    expect(wrapper.find('.notes__date').attributes('href')).toBe('/log')
  })

  it('keeps line breaks in a note rather than collapsing them', async () => {
    // Notes are prose; a multi-line one that renders as a single run reads as
    // a different note from the one that was written.
    const wrapper = await mountPage()
    const multiline = wrapper.findAll('.notes__text')[1]!
    expect(multiline.text()).toContain('swim')
    expect(multiline.text()).toContain('felt easy')
  })

  it('explains an empty list rather than looking broken', async () => {
    response = { habit: { id: 1, name: 'Exercise' }, notes: [] }
    const wrapper = await mountPage()
    expect(wrapper.find('.notes__list').exists()).toBe(false)
    expect(wrapper.text()).toContain('Nothing written yet')
    expect(wrapper.text()).toContain('Exercise')
  })

  it('says so when no habit was named, instead of requesting nothing', async () => {
    query = {}
    const wrapper = await mountPage()
    expect(fetchHabitNotes).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('No habit chosen')
  })

  it('rejects a non-numeric habit id rather than asking for NaN', async () => {
    query = { habit: 'abc' }
    const wrapper = await mountPage()
    expect(fetchHabitNotes).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('No habit chosen')
  })

  it('surfaces a failure instead of showing an empty page', async () => {
    fetchHabitNotes.mockRejectedValueOnce(new Error('Network down'))
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('Network down')
  })
})
