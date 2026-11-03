---
name: start-ht
description: Daily review from the habit tracker — today's focus, what needs attention across the team (old PRs, overloaded people), whether the week's objectives are on track, and the questions to ask today. Use when the user types /start-ht, says "start habit tracker", "daily review", "what should I focus on today", or "what needs attention".
---

# /start-ht — daily review

Pull the day from the habit tracker, cross-reference it with GitHub and Jira, and write one
report in the fixed shape below. The habit tracker never talks to GitHub or Jira itself — you
do, with your own tools.

## 0. Check the habit tracker is connected

The tools are named `mcp__habit-tracker__*`. If none are available, stop and print this, then end:

```bash
claude mcp add --transport http habit-tracker https://<habit-tracker-host>/api/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

(The token is `MCP_TOKEN` from the app's Vercel environment. Restart Claude Code afterwards.)

## 1. Read the day

Call these; none needs arguments (dates default to today in the user's zone):

- `get_daily_report` — the fixed report; keep its text for section 1 below.
- `get_week_objectives` — this week's targets. `stale: true` means none were written this week.
- `get_team_initiatives` with `limit: 3` — what the team is moving towards.
- `get_team` — the team members. A name may carry a GitHub login or Jira name in brackets,
  e.g. `Daren (dcastro)`; match on those when present, otherwise on the name.
- `list_questions` — the questions attached to today's habits.

## 2. Pull what needs attention

**Pull requests** — open PRs in `Catena-Media/catena-unicorn`
(https://github.com/Catena-Media/catena-unicorn/pulls). Use the GitHub MCP tools if present,
otherwise `gh pr list --repo Catena-Media/catena-unicorn --state open --json number,title,author,createdAt,url,isDraft,reviewDecision`.
Flag every non-draft PR **opened more than 7 days ago**, oldest first, marking which belong to
team members. Note the review state (approved / changes requested / waiting).

**Jira** — the COS board (https://catenamedia.atlassian.net/jira/software/projects/COS/boards/2324),
using the Atlassian/Jira tools if connected. JQL:
`project = COS AND statusCategory = "In Progress" ORDER BY assignee`.
Count tickets per assignee for the team members only. **More than 2 in progress for one person
is a flag.** If no Jira tools are available, say so in the report and carry on — never guess
the numbers.

## 3. Judge

- **Objectives**: for each objective, is the work that serves it moving (merged or approved PRs,
  tickets advancing) or stuck (old PRs, nothing in progress)? Say on track / at risk / off
  track, with the evidence.
- **Who needs support**: someone with old PRs waiting on review, too many tickets in progress,
  or nothing visibly moving. Name the person and the reason. Be factual, not judgemental.
- **Am I behind?**: the user's own tickets and PRs against the objectives, plus the morning
  habits not done in the daily report. Give an honest yes/no with the reason.

## 4. Write the report — always this shape

```
# Daily review — <Weekday YYYY-MM-DD>

## 1. Focus now
<the in-focus part of the day from get_daily_report: habits not yet done, with their questions>

## 2. Needs attention
### PRs open more than 7 days
- #<n> <title> — <author>, <age> days, <review state> — <url>
### More than 2 tickets in progress
- <person>: <count> — <ticket keys>

## 3. This week's objectives
- <objective> — on track | at risk | off track: <evidence>

## 4. Who needs support
- <person> — <reason>

## 5. Am I behind?
<yes/no — reason>

## 6. Questions to ask today
- <from list_questions>
- <ones raised by sections 2–5>
```

Write "none" under a heading that has nothing, never drop the heading.

## 5. Offer to write it down

Ask whether to record anything, then use `log_habit`:
- the team recap → `habit: "Recap team initiatives", note: …`
- checked people → `habit: "Check what each team member is working on", steps: [names]`
- the end of the day → `habit: "What did I do today", note: …`

Never log without the user's yes.
