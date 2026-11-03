import { and, asc, desc, eq, gte, isNotNull, lte, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { habitEntries, habits, habitSteps, type Habit } from '../db/schema.js'
import { endOfWeek, isValidDateKey, nowIn, startOfWeek, today } from '../lib/date.js'
import { EVENING_STARTS_AT } from '../lib/schedule.js'
import { PLAN_THE_WEEK, RECAP, TEAM_CHECK } from '../lib/work-routine.js'
import { loadToday } from '../routes/today.js'
import type { ToolResult } from './protocol.js'
import { createRegistry, type Tool } from './registry.js'
import { buildReport, renderReport, type Objectives } from './report.js'

/** A failure Claude should read and correct, not a protocol fault. */
class ToolError extends Error {}

const ok = (text: string, structuredContent: unknown): ToolResult => ({
  content: [{ type: 'text', text }],
  structuredContent,
})

const DATE_SCHEMA = {
  type: 'string',
  description: 'YYYY-MM-DD in the user\'s time zone. Defaults to today.',
}

const dateArg = z.string().optional()

/** A real, non-future day; today when omitted (D-40). */
function resolveDate(value: string | undefined): string {
  if (value === undefined) return today()
  if (!isValidDateKey(value)) throw new ToolError(`"${value}" is not a date written as YYYY-MM-DD.`)
  if (value > today()) throw new ToolError(`${value} is in the future; today is ${today()}.`)
  return value
}

/** A habit by id or by name, ignoring case (D-41). Archived habits are out of reach. */
async function findHabit(ref: string | number): Promise<Habit> {
  const candidates = await db.select().from(habits).where(ne(habits.status, 'archived'))
    .orderBy(asc(habits.position), asc(habits.id))
  const matches = typeof ref === 'number'
    ? candidates.filter(habit => habit.id === ref)
    : candidates.filter(habit => habit.name.toLowerCase() === ref.trim().toLowerCase())
  if (matches.length === 1) return matches[0]!

  const names = candidates.map(habit => `"${habit.name}"`).join(', ')
  if (matches.length > 1) throw new ToolError(`More than one habit is called "${ref}"; pass its id instead. Habits: ${names}.`)
  throw new ToolError(`No habit called "${ref}". Habits: ${names}.`)
}

/** Dated notes on one habit, newest first, optionally within a date range. */
async function notesOf(habitId: number, limit: number, range?: { from?: string, before?: string, to?: string }) {
  const conditions = [eq(habitEntries.habitId, habitId), isNotNull(habitEntries.note), ne(habitEntries.note, '')]
  if (range?.from) conditions.push(gte(habitEntries.date, range.from))
  if (range?.to) conditions.push(lte(habitEntries.date, range.to))
  if (range?.before) conditions.push(lt(habitEntries.date, range.before))
  const rows = await db.select({ date: habitEntries.date, note: habitEntries.note }).from(habitEntries)
    .where(and(...conditions)).orderBy(desc(habitEntries.date)).limit(limit)
  return rows.map(row => ({ date: row.date, note: row.note ?? '' }))
}

/** This week's "Plan the week" note, else the latest earlier one marked stale. */
async function weekObjectives(date: string): Promise<Objectives | null> {
  const plan = await findHabit(PLAN_THE_WEEK)
  const week = startOfWeek(date)
  const [current] = await notesOf(plan.id, 1, { from: week, to: endOfWeek(date) })
  if (current) return { ...current, stale: false }
  const [earlier] = await notesOf(plan.id, 1, { before: week })
  return earlier ? { ...earlier, stale: true } : null
}

function tool<S extends z.ZodTypeAny>(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  schema: S,
  run: (args: z.infer<S>) => Promise<ToolResult>,
): Tool {
  return {
    definition: { name, description, inputSchema: { type: 'object', properties, additionalProperties: false } },
    async run(raw) {
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        return { content: [{ type: 'text', text: `Invalid arguments: ${issue?.path.join('.') || 'input'} — ${issue?.message}` }], isError: true }
      }
      try {
        return await run(parsed.data)
      } catch (err) {
        if (err instanceof ToolError) return { content: [{ type: 'text', text: err.message }], isError: true }
        throw err
      }
    },
  }
}

const dateOnly = z.object({ date: dateArg })

export const TOOLS: Tool[] = [
  tool(
    'get_today',
    'Both parts of the day: morning (work) and evening (personal) habits with their progress, steps, questions and what is carried over from earlier in the week. `front` says which part is in focus right now (null for a past day).',
    { date: DATE_SCHEMA },
    dateOnly,
    async args => {
      const date = resolveDate(args.date)
      const day = await loadToday(date)
      const now = nowIn(process.env.HABIT_TIMEZONE)
      const front = date !== now.date ? null : !day.morningVisible || now.hour >= EVENING_STARTS_AT ? 'evening' : 'morning'
      const line = (slot: 'morning' | 'evening') =>
        `${slot}: ${day.slots[slot].done}/${day.slots[slot].total} — ${day.slots[slot].habits.map(h => `${h.entry?.completed ? '✓' : '·'} ${h.name}`).join(', ') || 'nothing'}`
      return ok([date, ...(day.morningVisible ? [line('morning')] : []), line('evening')].join('\n'), { ...day, front })
    },
  ),
  tool(
    'list_questions',
    'The questions attached to the habits listed for a day — what to find out today. Morning first.',
    { date: DATE_SCHEMA },
    dateOnly,
    async args => {
      const day = await loadToday(resolveDate(args.date))
      const questions = (['morning', 'evening'] as const).flatMap(slot => day.slots[slot].habits
        .filter(habit => habit.question)
        .map(habit => ({ habit: habit.name, slot, question: habit.question!, done: habit.entry?.completed ?? false })))
      const text = questions.length
        ? questions.map(q => `- ${q.question} (${q.habit}${q.done ? ', done' : ''})`).join('\n')
        : 'No questions for this day.'
      return ok(text, { date: day.date, questions })
    },
  ),
  tool(
    'get_daily_report',
    'The daily report in its fixed shape: each part of the day with every habit\'s status, this week\'s objectives and today\'s notes. Show the text as it is.',
    { date: DATE_SCHEMA },
    dateOnly,
    async args => {
      const date = resolveDate(args.date)
      const report = buildReport(await loadToday(date), await weekObjectives(date))
      return ok(renderReport(report), report)
    },
  ),
  tool(
    'get_week_objectives',
    `What this week is meant to achieve: the note on "${PLAN_THE_WEEK}" for the week containing the date. If none was written this week, the latest earlier one with stale: true.`,
    { date: DATE_SCHEMA },
    dateOnly,
    async args => {
      const objectives = await weekObjectives(resolveDate(args.date))
      const text = !objectives
        ? 'None written yet.'
        : `${objectives.stale ? `None this week; last set ${objectives.date}` : `Set ${objectives.date}`}:\n${objectives.note}`
      return ok(text, { objectives })
    },
  ),
  tool(
    'get_team_initiatives',
    `The latest recaps of what the team is working on and moving towards (notes on "${RECAP}"), newest first.`,
    { limit: { type: 'integer', minimum: 1, maximum: 30, description: 'How many recaps. Default 5.' } },
    z.object({ limit: z.number().int().min(1).max(30).default(5) }),
    async args => {
      const notes = await notesOf((await findHabit(RECAP)).id, args.limit)
      return ok(notes.length ? notes.map(n => `${n.date}: ${n.note}`).join('\n') : 'No recaps written yet.', { notes })
    },
  ),
  tool(
    'get_team',
    `The team members, read from the steps of "${TEAM_CHECK}".`,
    {},
    z.object({}),
    async () => {
      const team = (await db.select({ label: habitSteps.label }).from(habitSteps)
        .where(eq(habitSteps.habitId, (await findHabit(TEAM_CHECK)).id))
        .orderBy(asc(habitSteps.position), asc(habitSteps.id))).map(row => row.label)
      return ok(team.length ? team.join(', ') : `No names yet — add them as steps on "${TEAM_CHECK}".`, { team })
    },
  ),
  tool(
    'get_habit_notes',
    'Notes written on any habit, newest first.',
    {
      habit: { type: ['string', 'integer'], description: 'The habit\'s name (any case) or id.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 10.' },
    },
    z.object({ habit: z.union([z.string().min(1), z.number().int()]), limit: z.number().int().min(1).max(50).default(10) }),
    async args => {
      const habit = await findHabit(args.habit)
      const notes = await notesOf(habit.id, args.limit)
      return ok(notes.length ? notes.map(n => `${n.date}: ${n.note}`).join('\n') : `No notes on "${habit.name}".`, { habit: habit.name, notes })
    },
  ),
]

export const habitTools = createRegistry(TOOLS)
