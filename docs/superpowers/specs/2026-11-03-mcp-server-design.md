# Habit tracker MCP server — design

> Status: approved in conversation 2026-11-03 (scope and auth); detail decided during writing
> Date: 2026-11-03
> Part 2 of 3. Part 3 (the "what needs attention" review) ships here as the `/start-ht` skill.

## Why

The Today view tells you what to do; Claude should be able to read the same thing and help with
it: list the questions to ask today, summarise the day in a fixed shape, remind you of team
initiatives and this week's objectives, and — combined with the GitHub and Jira tools Claude
already has — say what needs attention.

## Constraints from the conversation

- **Claude Code only.** Company policy blocks unapproved claude.ai connectors; that control is
  respected, not worked around. Claude Code registers the server over HTTP with a bearer token.
- **The habit tracker never calls GitHub or Jira.** Claude does, through its own connectors. No
  work credentials are stored in this app.
- Work data (teammates' names, initiatives) lands in this personal database — the user was told
  and accepted that.

## Decisions

**D-38 — `POST /api/mcp`, stateless JSON-RPC, no SDK.** The server implements the MCP
Streamable HTTP transport in its stateless form: every request is one JSON-RPC message answered
with `application/json`; notifications get `202`; `GET` and `DELETE` get `405` (no server
stream, no sessions). Methods: `initialize`, `ping`, `tools/list`, `tools/call`. That subset is
all Claude Code needs, keeps the Vercel function free of long-lived connections, and adds no
dependency (`@modelcontextprotocol/sdk`'s web-standard transport would pull its own Zod major
alongside ours). Protocol version: echo the client's if it is one we know
(`2025-06-18`, `2025-03-26`), otherwise answer `2025-06-18`.

**D-39 — a bearer token, separate from the Google session.** `MCP_TOKEN` (≥ 32 chars) in the
environment; requests must send `Authorization: Bearer <token>`, compared in constant time. Unset
or short token → every MCP request is `401`, never open. The MCP route is mounted before the
session middleware, and the session cookie does *not* authorise it (a browser tab must not be
able to drive tools). The token is never logged.

**D-40 — the user's day is computed in `HABIT_TIMEZONE`.** Vercel runs in UTC, so between local
midnight and UTC midnight the server thinks it is still yesterday — `/api/log` and `/api/today`
then reject the browser's real date as "future". `today()` in `server/lib/date.ts` uses
`HABIT_TIMEZONE` (IANA name, e.g. `Europe/Malta`) when set, the process clock otherwise (tests,
local dev). MCP tools default their `date` argument to that day and their "which slot is in front"
answer to that zone's hour.

**D-41 — tools address habits by name, case-insensitively, or by id.** Claude reads names, not
ids. An ambiguous or unknown name is a tool error that lists the active habit names, so the next
call can correct itself.

**D-42 — the review procedure lives in the skill, not the server.** `/start-ht` is a Claude Code
skill kept in this repo (`claude/skills/start-ht/SKILL.md`) and symlinked into
`~/.claude/skills/`. It says which tools to call, what to pull from GitHub and Jira, the
thresholds, and the report's fixed shape. Changing a rule is editing a markdown file — no deploy.
The team list is the steps of "Check what each team member is working on", so the skill reads
it rather than hard-coding names.

## Tools

All take an optional `date` (YYYY-MM-DD, default today per D-40). All return a short text
rendering *and* `structuredContent` with the same data.

| Tool | Returns |
|---|---|
| `get_today` | Both slots exactly as `/api/today` builds them, plus `front` (`morning`/`evening`) for the current hour. |
| `list_questions` | Every habit listed today that carries a question: `{ habit, slot, question, done }`, front slot first. |
| `get_daily_report` | The fixed daily shape: per slot `done/total` and each habit's status (done / partial n of m / not yet / carried from X); this week's objectives; today's notes from journal habits. The text rendering is the report. |
| `get_week_objectives` | The note on "Plan the week" for this week (Mon–Sun containing `date`), with its date; if none this week, the latest earlier one flagged `stale: true`. |
| `get_team_initiatives` | The latest `limit` (default 5, max 30) notes of "Recap team initiatives", newest first. |
| `get_team` | The step labels of "Check what each team member is working on" — the team list. |
| `get_habit_notes` | Any habit's notes, newest first, `limit` default 10. |
| `log_habit` | Write one habit for one day: `completed`, `value`, `note`, or `steps` **by label**. Same rules as `PUT /api/log` (D-1, D-6, D-30, D-32) via the shared save function. Returns the saved entry. |

The habit names used by `get_week_objectives`, `get_team_initiatives` and `get_team` are the
seeded names (`server/lib/work-routine.ts` exports them); renaming those habits breaks those three
tools with a clear error naming what they looked for.

## Units

| Unit | Responsibility |
|---|---|
| `server/lib/date.ts` | `today()` honours `HABIT_TIMEZONE`; new `nowIn(tz)` → `{ date, hour }`. |
| `server/lib/save-entries.ts` | The log PUT's transaction, extracted so `/api/log` and `log_habit` share it. |
| `server/mcp/protocol.ts` | Pure JSON-RPC: parse, dispatch, error codes (`-32700`, `-32600`, `-32601`, `-32602`). |
| `server/mcp/tools.ts` | Tool definitions (name, description, input JSON Schema) and handlers. |
| `server/mcp/report.ts` | Pure: builds the daily report object and its text from a `TodayResponse` + notes. |
| `server/mcp/auth.ts` | Bearer check (D-39). |
| `server/routes/mcp.ts` | Hono route: auth → protocol → JSON response / 202 / 405. |
| `claude/skills/start-ht/SKILL.md` | The `/start-ht` review procedure (D-42). |

## Error handling

- Tool failures (unknown habit, bad date, future date, foreign step label) return a normal
  result with `isError: true` and a message Claude can act on — not a JSON-RPC error, which MCP
  reserves for protocol faults.
- Unexpected exceptions → JSON-RPC `-32603` with "Internal error" only; details go to the server
  log the same way `app.onError` does (message and stack, never the object).

## Testing

- Protocol: initialize (version echo and fallback), notification → 202, unknown method,
  malformed JSON, batch arrays rejected, GET → 405.
- Auth: missing / wrong / unset-env token → 401; session cookie alone → 401; correct token → 200.
- Each tool against PGlite with the seeded routine: shapes, name lookup (case, unknown,
  ambiguous), objectives stale fallback, `log_habit` by step label, journal completion.
- `today()` with `HABIT_TIMEZONE` at an instant where UTC and Malta disagree on the date.
- Report rendering: a fixed fixture produces the exact expected text.

## Setup the user does once

1. `openssl rand -base64 32` → `MCP_TOKEN` in Vercel and `.env`; `HABIT_TIMEZONE=Europe/Malta`
   in Vercel.
2. `claude mcp add --transport http habit-tracker https://<app>/api/mcp --header "Authorization: Bearer <token>"`
3. `ln -s ~/personal/habit-tracker/claude/skills/start-ht ~/.claude/skills/start-ht`

## Out of scope

- claude.ai connectors and OAuth.
- Server-initiated messages, resources, prompts, sampling.
- Any GitHub or Jira access from the server.
