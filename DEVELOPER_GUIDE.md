# Mobile Team Agent — Developer Guide

A practical, no-fluff guide for developers using the Mobile Team Agent in their daily workflow. No prior knowledge of the agent is needed.

---

## What Is This?

Mobile Team Agent is your AI-powered developer assistant that lives inside Claude Code. It connects to your **Jira** and **Git** to help you:

- Plan your day with prioritized tickets and code context
- Track what's done, what's pending, and what's blocked
- Understand what code you actually changed — files, directories, lines, diffs
- Generate end-of-day reports automatically (tickets + code changes + non-ticket work)
- Never lose track of newly assigned tickets
- Maintain a daily work log that your manager can actually read

Think of it as a smart assistant that reads your Jira board, your Git commits, **and the actual code diffs**, then tells you exactly what needs attention and where you left off.

---

## Quick Start (5 minutes)

### Step 1: Install

**Mac / Linux:**
```bash
cd "Mobile Team Agent"
chmod +x install.sh && ./install.sh
```

**Windows:**
```
Double-click install.bat
```

### Step 2: Open Claude Code and activate

```
claude
```

Then type:
```
invoke mobile-team-agent
```

The agent checks what's connected and what needs setup.

### Step 3: Connect Jira

When prompted, provide your Jira credentials:
```
configure jira
```

You'll need:
- **Jira URL**: e.g. `https://yourcompany.atlassian.net`
- **Email**: Your Jira login email
- **API Token**: Generate at https://id.atlassian.com/manage-profile/security/api-tokens

The agent verifies the connection automatically.

### Step 4: Set your defaults (optional but recommended)

After connecting, the agent will ask if you want to save your default project and sprint. Say yes — this prevents it from asking every time.

You can also set them manually:
```
Set my default project to PROJ
Set my name to Alex
```

**That's it. You're ready to go.**

---

## Daily Workflow

Here's how a typical day looks with the agent:

### Morning: Start Your Day

Say any of these:
```
Good morning
Start my day
Let's start
```

**What you get:**
- New tickets assigned to you since yesterday (flagged separately so you don't miss them)
- Overdue tickets (past due date)
- High-priority items
- What you were working on (with recent commit counts per ticket)
- Items carried from yesterday
- Quick-pick suggestions to start working immediately

### Morning: Deep Planning (recommended)

For a more thorough analysis, say:
```
Plan my day
Let's plan today's work
What should I focus on today
```

**What you get (beyond the standup):**

- **Yesterday's completed work** — so you know where you left off
- **Recent code activity** — the agent reads your actual Git diffs and tells you:
  - Which directories/modules you were working in (e.g. `src/auth/`, `src/api/`)
  - Most changed files (e.g. `jwt.js +85/-12, middleware.js +40/-5`)
  - Total lines added/removed across all commits
  - Commits linked to specific Jira tickets
- **Blocked tickets** with blocker details (which ticket blocks what) and latest Jira comments
- **Overdue tickets** with exact days-overdue count
- **In-progress tickets** with latest comment context from Jira
- **Not-started tickets** (flagging which ones are newly assigned)
- **A numbered, prioritized action plan:**
  1. Unblock (if anything is blocked)
  2. Urgent (overdue items)
  3. Continue (work in progress)
  4. Next (high priority not started)
  5. Review (newly assigned tickets)

**Example output:**
```
RECENT CODE ACTIVITY (48 hours ago):
  5 commit(s), +210/-48 lines

  Areas worked on:
    src/auth — 3 file(s), +150/-30
    src/api/routes — 2 file(s), +60/-18

  Most changed files:
    src/auth/jwt.js — +85/-12 (3 commits)
    src/auth/middleware.js — +40/-5 (2 commits)
    src/api/routes/login.js — +25/-13 (1 commit)

  Commits linked to tickets:
    PROJ-123: 3 commit(s) — Fix JWT validation; Add token refresh; Update middleware
    PROJ-456: 2 commit(s) — Add login rate limiting; Update route tests
```

This tells you: "Yesterday you were deep in auth logic — `jwt.js` and `middleware.js`. You should continue there for PROJ-123."

---

### Code Change Awareness

The agent doesn't just read commit messages — it analyzes the **actual code changes** (diffs) in your commits. This runs automatically in `plan_my_day` and `end_of_day_report`, but you can also use it directly:

**Check what you changed recently:**
```
Show me my recent commits
```

Shows every commit with:
- Commit message and author
- Linked Jira ticket IDs (auto-extracted from messages)
- Files changed with lines added/removed per file
- Work area summary (which parts of the codebase were touched most)

**Deep-dive into a specific commit:**
```
Show me the details of commit abc1234
What did I change in commit abc1234?
```

Shows the **full diff** — actual code changes (the patch), all files modified, line counts, and any Jira tickets referenced in the diff content.

**When this is useful:**
- Monday morning — "What was I working on Friday?" → `Plan my day` shows your recent code areas
- Before marking a ticket done — "What code changes went into PROJ-123?" → check commits linked to that ticket
- EOD report — your report automatically includes "Code Changes Today: modified 5 files in `src/auth/`, +210/-48 lines"
- Code review context — "Show me details of commit abc1234" to see the full patch

---

### During the Day: Work on Tickets

**Pick a ticket to work on:**
```
PROJ-123
```
The agent shows full details: description, comments, subtasks, linked issues, and suggests an implementation plan.

**Start working on it:**
```
Start working on PROJ-123
```
Moves the ticket to "In Progress" in Jira (asks for confirmation first).

**Check what you should work on next:**
```
What should I work on?
```
Returns AI-scored recommendations based on priority, due dates, and blockers.

**See all your tickets:**
```
Show me my tickets
What's on my plate?
What am I working on?
```

**Filter by status, priority, or type:**
```
Show me my high priority tickets
What's in progress?
Show me bugs in PROJ
What's due this week?
```

**Analyze your full workload:**
```
What's my workload?
Analyze my workload
```
Categorizes all your tickets: Done, In Progress, Not Started, Blocked, Overdue — with blocker detection across issue links, labels, and status text.

---

### Throughout the Day: Memory & Journal

The agent has **persistent memory** that survives across sessions. Use it to save notes, log progress, and record decisions — so you never lose context.

**Save a note about a ticket:**
```
Remember that PROJ-123 needs the backend deploy before we can test
Note: the auth refactor depends on PROJ-456 being merged first
```

The agent auto-detects ticket keys in your text and links them. Next time you open PROJ-123 (via `select_ticket`), your notes appear automatically.

**Log what you're doing (work journal):**
```
I just finished the login API refactor
Switching to PROJ-789 now
Started code review for PR #45
```

Unlike EOD reports (which are end-of-day snapshots), journal entries are **real-time**. They're timestamped and auto-linked to any mentioned tickets. Journal entries also feed into your EOD report automatically.

**Record decisions:**
```
We decided to use Redis instead of Memcached for session storage
The plan is to deprecate the old auth endpoint after sprint 12
```

Decisions stay active until you resolve them. They surface in your `plan_my_day` output so you don't forget.

**Recall past context:**
```
What did I note about PROJ-123?
Remind me about the Redis decision
Show my journal
What decisions are pending?
```

**Why this matters:**
- Monday morning: "Plan my day" shows your notes on in-progress tickets — you remember exactly where you left off
- Ticket deep-dive: `PROJ-123` automatically shows your saved notes alongside Jira data
- EOD reports: journal entries are included automatically — no need to remember what you did
- Cross-session: decisions and notes persist forever until you clear them

---

### End of Day: Wrap Up

Say any of these:
```
End of day
I'm done for the day
EOD
Wrap up
```

**What the report includes:**

1. **Summary** — commit count, tickets completed, tickets in progress, carry-forward count

2. **Attention Needed** (if any):
   - Overdue tickets (past due date)
   - High-priority items still pending
   - Blocked items

3. **Code Changes Today** — the agent analyzes your Git diffs and shows:
   - Total commits, lines added/removed
   - Areas of codebase touched (e.g. `src/auth — 3 files, +150/-30`)
   - Top files modified with line counts

4. **Non-ticket work** (if you mentioned any)

5. **Carry forward** — items that will appear in tomorrow's standup

The report is saved automatically to `~/.mobile-team-agent/daily-reports/`.

**Include non-ticket work:**

Meetings, code reviews, architecture discussions, pair programming — these don't show up in Jira or Git. When wrapping up, just mention them:
```
I'm done for the day. I also did a design review for 2 hours, team standup, and code review for PR #45
```

These entries appear in your saved report under both "Completed" and "Non-ticket work" sections.

**Example EOD output:**
```
End-of-Day Report — 2026-03-27

SUMMARY:
- 5 commit(s)
- 2 ticket(s) completed
- 3 non-ticket activities
- 1 ticket(s) in progress
- 1 item(s) carry forward

ATTENTION NEEDED:
  OVERDUE (1):
    - PROJ-789: Update payment flow (due 2026-03-25)
  HIGH PRIORITY PENDING (1):
    - PROJ-456: Fix login rate limiting [High]

CODE CHANGES TODAY:
  5 commit(s), +210/-48 lines
  Areas:
    src/auth — 3 file(s), +150/-30
    src/api/routes — 2 file(s), +60/-18
  Top files:
    src/auth/jwt.js (+85/-12)
    src/auth/middleware.js (+40/-5)

NON-TICKET WORK:
  - Design review for 2 hours
  - Team standup
  - Code review for PR #45
```

---

### Weekly: Review Your Week

```
Weekly summary
```

Aggregates all your daily reports from the last 7 days:
- How many days you filed reports
- Total commits
- All items completed
- Items still in progress
- Blockers encountered

---

## Slash Commands

Type these directly in Claude Code for instant access — no natural language needed:

| Command | What it does |
|---------|-------------|
| `/plan` | Deep daily plan — tickets, code changes, blockers, memory, action plan |
| `/standup` | Quick morning standup overview |
| `/eod` | Generate & save end-of-day report |
| `/eod design review 2h, team sync` | EOD report with non-ticket work included |
| `/tickets` | Show all your open tickets |
| `/tickets CMDN` | Show tickets for a specific project |
| `/tickets bugs` | Show your bugs |
| `/ticket PROJ-123` | Deep dive into a specific ticket |
| `/workload` | Categorized breakdown: done, in progress, blocked, overdue |
| `/suggest` | AI-scored "what should I work on next?" |
| `/commits` | Recent commits with file diffs and work area analysis |
| `/commits 7 days ago` | Commits for a custom time period |
| `/remember PROJ-123 needs backend deploy first` | Save a note to memory |
| `/recall PROJ-123` | Recall all notes for a ticket |
| `/recall Redis` | Search memory by keyword |
| `/journal finished the login API refactor` | Log real-time work progress |
| `/journal` | Show today's journal (no args) |
| `/decide use Redis instead of Memcached` | Record a decision |
| `/decisions` | Show active decisions |
| `/weekly` | Weekly summary from last 7 daily reports |
| `/health` | Test Jira, Git, and report storage |
| `/status` | Show connection status and preferences |
| `/memory` | Memory usage stats |

---

## Natural Language Commands (also works)

You can also use natural language — the agent understands intent:

### Everyday Commands

| What to say | What it does |
|-------------|--------------|
| `Good morning` / `Start my day` | Quick morning standup with new tickets and overview |
| `Plan my day` / `Let's plan today's work` | Deep analysis: code changes, blockers, prioritized action plan |
| `End of day` / `I'm done for the day` | Generate & save daily report with code change analysis |
| `PROJ-123` | Deep dive into a specific ticket |
| `What should I work on?` | AI-scored ticket recommendations |
| `Show me my tickets` | List all your open tickets |
| `What's my workload?` | Categorized breakdown (done, in progress, blocked, overdue) |
| `Weekly summary` | Aggregate last 7 daily reports |

### Memory & Journal

| What to say | What it does |
|-------------|--------------|
| `Remember that PROJ-123 needs X` | Save a note linked to a ticket |
| `Note: the auth refactor depends on PROJ-456` | Save a context note (auto-links ticket) |
| `I just finished the login refactor` | Journal entry — real-time work log |
| `Switching to PROJ-789 now` | Journal entry with auto ticket linking |
| `We decided to use Redis for sessions` | Record a persistent decision |
| `What did I note about PROJ-123?` | Recall memory for a ticket |
| `Remind me about the Redis decision` | Search memory by keyword |
| `Show my journal` | Today's journal entries |
| `What decisions are pending?` | Active (unresolved) decisions |
| `Forget about PROJ-123` | Clear all notes for a ticket |
| `Memory status` | How much is stored |

### Code & Git Commands

| What to say | What it does |
|-------------|--------------|
| `Show me my recent commits` | Commits with file-level diffs and work area analysis |
| `Show me details of commit abc1234` | Full diff — actual code changes, files, lines, linked tickets |
| `What did I change recently?` | Work area summary — which parts of the codebase you touched |

### Ticket Actions

| What to say | What it does |
|-------------|--------------|
| `Start working on PROJ-123` | Move ticket to "In Progress" |
| `Move PROJ-123 to Done` | Transition ticket status |
| `Add a comment to PROJ-123: Fixed the null pointer issue` | Add comment to ticket |
| `Log 2 hours on PROJ-123` | Log work time |
| `Create a bug ticket: Login page crashes on Safari` | Create new ticket |
| `Assign PROJ-123 to John` | Reassign a ticket |

### Navigation

| What to say | What it does |
|-------------|--------------|
| `Show me my projects` / `List Jira projects` | List all accessible projects |
| `Show sprints for PROJ` | List active/future sprints |
| `Show sprint board` | Categorized sprint view |
| `Show me bugs` / `Show high priority tickets` | Filtered ticket lists |
| `What's due this week?` | Tickets due this week |

### Setup & Health

| What to say | What it does |
|-------------|--------------|
| `invoke mobile-team-agent` | Activate agent, check status |
| `Configure jira` | Set up Jira connection |
| `Health check` | Test all integrations |
| `Set my default project to PROJ` | Save preferences |
| `Show my preferences` | View saved defaults |

### Figma Connect

| What to say | What it does |
|-------------|--------------|
| `Connect figma` | Returns step-by-step token setup (`configure_figma`) |
| `Read figma <url>` | List every top-level frame — names + dimensions only (`list_figma_screens`) |
| `Build the Login screen from figma` | Read the FULL design data for one screen (`read_figma_screen`) |
| `Suggest screens to implement` | 5 not-yet-implemented screens at a time (`suggest_figma_screens`) |

**Important:** `list_figma_screens` returns frame names only — not visual contents. Always call
`read_figma_screen` before writing code for a screen, or you will fabricate the UI.

---

## How Reports Work

### What Goes Into a Report

Every daily report captures **three layers** of your work:

| Layer | Source | What it captures |
|-------|--------|-----------------|
| **Jira tickets** | Jira API | Completed tickets, in-progress tickets, blockers, overdue items |
| **Code changes** | Git diffs | Files modified, lines added/removed, areas of codebase touched, commits linked to tickets |
| **Non-ticket work** | You tell the agent | Meetings, code reviews, design sessions, pairing — anything not in Jira or Git |

This means your report reflects **everything you did**, not just what a project management tool knows about.

### Daily Reports

Every time you run an end-of-day report, it's saved as a markdown file:
```
~/.mobile-team-agent/daily-reports/2026-03-27.md
```

The report contains:
- **Completed** — tickets marked done + non-ticket work entries
- **In Progress** — what you're still working on
- **Commits** — all git commits from today with ticket links
- **Code Changes** — areas touched, top files, line counts (from diff analysis)
- **Carry Forward** — items that will show up in tomorrow's standup
- **Blockers** — anything that's blocked
- **Notes** — summary stats

### How the Agent Uses Past Reports

- **Morning standup** reads yesterday's report to show carry-forward items
- **Plan my day** reads yesterday's report to show "Completed Yesterday" and carry-forward
- **Tomorrow's plan** will see today's in-progress items as carry-forward
- **Weekly summary** aggregates all 7 daily reports into one view

### Accessing Past Reports

```
Show me yesterday's report
Show me the report for 2026-03-20
List my daily reports
List reports from last week
```

### Weekly Summary

The weekly summary reads the last 7 daily reports and shows:
- How many days you filed reports
- Total commits
- All items completed
- Items still in progress
- Blockers encountered

---

## How Code Analysis Works

The agent uses `git diff-tree` and `git show` under the hood to analyze your commits. Here's what it does:

### For every commit:
- Runs `git diff-tree --numstat` to get files changed with insertion/deletion counts
- Can run `git show` to get the full patch (actual diff content) when you ask for details

### Work area analysis:
- Groups file changes by directory (first 2 path segments)
- Ranks areas by total changes (insertions + deletions)
- Identifies your most-changed files across multiple commits
- Links commits to Jira tickets via ticket IDs in commit messages

### Where this appears automatically:
- **`plan_my_day`** — "RECENT CODE ACTIVITY" section
- **`end_of_day_report`** — "CODE CHANGES TODAY" section
- **`get_recent_commits`** — per-commit file stats + work area summary

### Limits (to keep things fast):
- Max 15 commits analyzed for diffs at once
- Max 200 lines per commit diff (truncated with note)
- Max 20 files listed per commit stat
- Non-blocking — if Git is unavailable, reports still generate with Jira data only

---

## Tips & Best Practices

### 1. Start with "Plan my day" instead of just "Good morning"

The morning standup is a quick overview. "Plan my day" does a deeper analysis — it reads ticket comments, checks blocker chains, analyzes your recent code changes, and tells you exactly what to work on in what order. It also shows which files you were modifying, so you know where to pick up.

### 2. Always mention non-ticket work at EOD

Meetings, code reviews, architecture discussions, pair programming — these don't show up in Jira or Git. When wrapping up, say:
```
I'm done. I also did: 2h design review, team sync, helped debug PROJ-456 with Sarah
```

This makes your daily reports actually reflect what you did, not just what tools know about.

### 3. Save your preferences early

After your first successful query, the agent will ask if you want to save your project as default. **Say yes.** This prevents the agent from asking "which project?" every time.

### 4. Use ticket keys for deep dives

Just say a ticket key (`PROJ-123`) and the agent will show you everything: description, comments, subtasks, linked issues. This is faster than opening Jira in a browser.

### 5. Let the agent manage transitions

Instead of opening Jira to move a ticket, just tell the agent:
```
Move PROJ-123 to In Progress
```

It confirms before making changes, so there's no risk of accidental updates.

### 6. Use commit details to verify work

Before marking a ticket as done, check what code actually changed:
```
Show me my recent commits
```

This shows file-level changes linked to tickets — useful for self-review and making sure nothing was missed.

### 7. Check health if something feels off

If queries return unexpected results or fail silently:
```
Health check
```

This tests Jira connectivity, Git availability, and report storage in one shot.

---

## Troubleshooting

### "Jira not configured"

Run `configure jira` and provide your URL, email, and API token. Generate a token at: https://id.atlassian.com/manage-profile/security/api-tokens

### "No tickets found" when you know you have some

The agent will show you the exact JQL query it used. Common fixes:
- Check if the project key is correct (`list projects` to verify)
- Remove status filters by asking: "Show me all PROJ tickets including done"
- The saved default project might be stale — update it

### "Jira authentication failed"

Your API token may have expired. Generate a new one and run:
```
Configure jira
```

### Agent doesn't respond to commands

Make sure you've activated it first:
```
invoke mobile-team-agent
```

### Git data missing in reports

The agent reads Git from the current working directory. If you're in a different directory than your repo, Git data won't appear. This is non-blocking — the report still generates with Jira data.

### Reports directory

All reports are stored in `~/.mobile-team-agent/daily-reports/`. You can read them directly — they're plain markdown files.

---

## How It Works (for the curious)

The agent runs as an MCP (Model Context Protocol) server that Claude Code communicates with. It's registered at the **project level** via `.mcp.json`, so it activates only when you run `claude` from this project directory.

- **Project-scoped MCP** — the agent registers via `.mcp.json` in the project root, not globally. It only activates when you run `claude` from this project directory. To use it in another project, copy the `.mcp.json` file there.
- **No data leaves your machine** beyond Jira API calls (which use your own credentials)
- **Git analysis is local** — diffs are computed locally via `git diff-tree` and `git show`, nothing is sent anywhere
- **Preferences** are stored in `~/.mobile-team-agent/preferences.json`
- **Credentials** are stored in `~/.mobile-team-agent/config.json` (file permissions: 600)
- **Reports** are plain markdown in `~/.mobile-team-agent/daily-reports/`
- **Memory** is stored in `~/.mobile-team-agent/memory/` — ticket notes, journal, decisions (all JSON)
- **Offline resilience** — if Jira goes down, write actions are queued and can be synced later

### Architecture (for contributors)

```
Skills/
  WorkflowSkill.js   — morning_standup, plan_my_day, end_of_day_report (uses Git + memory)
  JiraReadSkill.js    — ticket queries, workload analysis, suggestions (surfaces memory on select)
  JiraWriteSkill.js   — transitions, comments, assignments, ticket creation
  GitSkill.js         — get_recent_commits (with diffs), get_commit_details (full patch)
  MemorySkill.js      — remember, recall, journal, decisions (10 tools)
  SetupSkill.js       — connection management, health checks, preferences

Utils/
  git-utils.js        — getCommitsWithDiffs(), analyzeWorkAreas(), getCommitDiff()

Services/
  jira-client.js      — Jira REST API with retry, rate-limit, auth handling
  report-manager.js   — daily/weekly report persistence and aggregation
  memory-manager.js   — ticket notes, journal, decisions, search (persistent JSON storage)
```

---

## Uninstall

**Mac / Linux:**
```bash
chmod +x uninstall.sh && ./uninstall.sh
```

**Windows:**
```
Double-click uninstall.bat
```

This removes the agent binary, MCP registration, and instructions. Your daily reports can be optionally preserved.
