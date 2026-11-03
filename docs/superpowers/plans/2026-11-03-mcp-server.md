# Habit tracker MCP server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A token-protected, stateless MCP endpoint at `POST /api/mcp` exposing the habit tracker's day, questions, report, objectives, initiatives, team and logging to Claude Code, plus the `/start-ht` review skill.

**Architecture:** Pure JSON-RPC dispatch (`server/mcp/protocol.ts`) over tool handlers (`server/mcp/tools.ts`) that reuse `loadToday`, the extracted `saveEntries`, and `deriveEntry`. Auth is a bearer check mounted before the session middleware.

**Tech Stack:** Hono, Drizzle, Zod (tool argument validation), Vitest + PGlite.

**Spec:** `docs/superpowers/specs/2026-11-03-mcp-server-design.md`

## Global Constraints

- No new dependencies.
- `MCP_TOKEN` ≥ 32 chars or every MCP request is 401; constant-time compare; never logged.
- Protocol versions known: `2025-06-18`, `2025-03-26`; default `2025-06-18`.
- `HABIT_TIMEZONE` (IANA) drives `today()` when set.
- Tool errors → `isError: true` results; protocol faults → JSON-RPC errors.
- Never run anything against `.env`'s `DATABASE_URL`.

## Review Focus

1. A browser holding a valid session cookie but no bearer token must get 401 from `/api/mcp`.
2. `MCP_TOKEN` unset in production must close the endpoint, not open it.
3. `log_habit` with a step label that does not exist → `isError` naming the habit's real steps.
4. `today()` just after local midnight in Malta while UTC is still on the previous day.
5. A JSON-RPC batch (array body) → `-32600`, not a crash.

---

### Task 1: Timezone-aware today

**Files:** `server/lib/date.ts`, `server/lib/date.spec.ts`
- Produces `nowIn(tz: string | undefined, at?: Date): { date: string, hour: number }`; `today()` = `nowIn(process.env.HABIT_TIMEZONE).date`.
- [ ] Tests: at `2026-11-02T23:30:00Z`, `nowIn('Europe/Malta')` → `{ date: '2026-11-03', hour: 0 }`; undefined tz falls back to the process clock; invalid tz falls back too.
- [ ] Commit `feat(api): compute the day in HABIT_TIMEZONE`.

### Task 2: Extract saveEntries

**Files:** create `server/lib/save-entries.ts`; modify `server/routes/log.ts`.
- Produces `saveEntries(date: string, entries: LogEntryInput[]): Promise<void>` throwing `LogEntryError(message, 400 | 404)`; `LogEntryError` moves here.
- [ ] Existing `server/routes/log.spec.ts` stays green unchanged (it is the test).
- [ ] Commit `refactor(api): share the day-save transaction`.

### Task 3: Protocol and auth

**Files:** `server/mcp/protocol.ts`, `server/mcp/auth.ts`, `server/routes/mcp.ts`, `server/app.ts`, specs `server/mcp/protocol.spec.ts`, `server/routes/mcp.spec.ts`.
- Produces `handleRpc(message: unknown, tools: ToolRegistry): Promise<object | null>` (null for notifications); `ToolRegistry = { list(): ToolDefinition[], call(name, args): Promise<ToolResult> }`; `bearerOk(header: string | undefined, token: string | undefined): boolean`.
- [ ] Tests per spec Testing → Protocol and Auth (with an empty registry).
- [ ] Commit `feat(mcp): stateless JSON-RPC endpoint behind a bearer token`.

### Task 4: Read tools and the report

**Files:** `server/mcp/tools.ts`, `server/mcp/report.ts`, specs.
- Tools `get_today`, `list_questions`, `get_daily_report`, `get_week_objectives`, `get_team_initiatives`, `get_team`, `get_habit_notes` per the spec table; habit lookup per D-41; seeded names imported from `work-routine.ts`.
- [ ] Tests per spec Testing → tools and report (fixed-fixture exact text).
- [ ] Commit `feat(mcp): read tools and the daily report`.

### Task 5: log_habit

**Files:** `server/mcp/tools.ts` (+ spec).
- Steps by label → ids; unknown label → `isError` listing the real labels; uses `saveEntries`.
- [ ] Tests: tick, amount, journal note completes, checklist by labels, unknown label, future date.
- [ ] Commit `feat(mcp): log a habit from Claude`.

### Task 6: /start-ht skill and docs

**Files:** `claude/skills/start-ht/SKILL.md`, `README.md`, `.env.example`, `DEPLOY.md`.
- Skill: frontmatter (`name: start-ht`, description triggering on "/start-ht", "start habit tracker", "daily review"); procedure: check the MCP is connected (else print the one-time setup), call `get_daily_report`, `get_week_objectives`, `get_team_initiatives`, `get_team`, `list_questions`; GitHub: open PRs in `Catena-Media/catena-unicorn` older than 7 days, by author; Jira: COS board 2324 open tickets in progress per assignee, flag > 2 per team member; compare with objectives; output the fixed report (Today's focus · Needs attention · Objectives on track? · Who needs support · Am I behind? · Questions for today); offer to log answers with `log_habit`.
- [ ] `pnpm typecheck && pnpm test && pnpm build`. Commit `feat: /start-ht skill and MCP setup docs`.
