# 🚀 Mobile Team Agent

> **v3.4.10** — Context-aware, memory-driven developer assistant with Jira + Git integration, smart ticket guidance, persistent preferences, intelligent workflow automation, Figma design-to-code, React Native project setup, deep code review, unit test generation, and session memory across days.

The **Mobile Team Agent** is an MCP (Model Context Protocol) server that plugs into **Claude CLI**. It gives Claude a full suite of tools for mobile developers — Jira ticketing, Git insights, Figma design reading, RN project scaffolding, code review, unit test generation, and persistent memory — all accessible via natural language.

---

## 📦 Installation

### Option 1 — npm (Recommended)

```bash
npm install -g mobile-team-agent
```

Then run setup **from inside your project directory:**

```bash
cd /path/to/your/project
npx mobile-team-agent setup
```

> ⚠️ **Always `cd` into your project first.** Setup writes a `CLAUDE.md` into the current directory so Claude knows the agent rules for that project.

`setup` does three things automatically:
1. Registers the MCP server with Claude CLI globally (`~/.claude/settings.json`)
2. Installs agent instructions to `~/.claude/CLAUDE.md`
3. Writes a `CLAUDE.md` into your **current project folder** with agent rules, daily workflow shortcuts, Change Safety Protocol, and memory shortcuts

**If your project already has a `CLAUDE.md`**, the agent block is safely appended between markers — your existing content is never touched.

**To add the agent to another project** later, just run setup from that project's root:
```bash
cd /path/to/another/project
npx mobile-team-agent setup
```

### Option 2 — Clone & install

```bash
git clone <repo-url>
cd "Mobile Team Agent"
chmod +x install.sh && ./install.sh
```

### Manual registration (fallback)

```bash
claude mcp add mobile-team-agent -- node $(npm root -g)/mobile-team-agent/Main/index.js
```

**Requirements:** Node.js ≥ 18, Claude CLI installed.

---

## ⚡ Quick Start

Once installed, open Claude CLI from any project directory:

```bash
claude
```

Activate the agent:
- `"invoke mobile-team-agent"` — activates, shows connection status, and surfaces your last session context
- `"Good morning"` / `"hi"` / `"start my day"` — morning standup
- `"plan my day"` — deep daily planning
- `"end of day"` / `"EOD"` — generate daily report + save session snapshot

---

## 🔌 Connecting Your Tools

### Jira
```
"connect Jira"
"configure Jira for project MyApp"
```
Or set environment variables:
```bash
export JIRA_URL="https://your-org.atlassian.net"
export JIRA_EMAIL="you@company.com"
export JIRA_TOKEN="your-api-token"
```

### Figma
```
"connect Figma"
"set up Figma"
```
The agent walks you through generating a Personal Access Token step by step. Once connected, paste the token (`figd_...`) and it's saved for all future sessions.

### Git
Git is auto-detected from the current directory — no setup needed.

---

## 🗂 All Tools by Category

### 🔧 Setup & Connection

| Tool | What it does | Say |
|------|-------------|-----|
| `invoke_mobile_team` | Activates the agent, scans project reports, restores last session context | `"invoke mobile-team-agent"` |
| `get_setup_status` | Shows connected integrations and saved preferences | `"check connection status"` |
| `configure_service` | Save Jira credentials (per project) | `"configure Jira"` |
| `switch_jira_project` | Switch active Jira project context | `"switch to MyApp project"` |
| `health_check` | Test all integrations | `"are my connections healthy?"` |
| `set_preferences` | Save default project/sprint/assignee/name | `"save these as defaults"` |
| `jira_connection_test` | Verify Jira token without reconfiguring | `"test Jira connection"` |

---

### 📋 Jira — Reading Tickets

| Tool | What it does | Say |
|------|-------------|-----|
| `list_tickets` | My open tickets (flexible filters) | `"show my tickets"` / `"list PROJ tickets"` |
| `smart_ticket_query` | Categorized sprint board view | `"show sprint board"` |
| `fetch_jira_tickets` | Raw JQL power queries | `"JQL: project = PROJ AND status = 'In Progress'"` |
| `get_ticket_details` | Full details: description, comments, changelog | `"tell me about PROJ-42"` |
| `select_ticket` | Pick a ticket + get an implementation plan | `"PROJ-42"` |
| `get_ticket_suggestions` | AI-scored recommendations on what to work on | `"what should I work on?"` |
| `analyze_workload` | Categorize all tickets: Done / In Progress / Blocked / Overdue | `"analyze my workload"` |
| `list_projects` | List all Jira projects | `"list Jira projects"` |
| `list_sprints` | List sprints for a project | `"show sprints for PROJ"` |
| `search_users` | Find Jira users by name/email | `"find user John"` |

---

### ✏️ Jira — Writing & Actions

| Tool | What it does | Say |
|------|-------------|-----|
| `transition_ticket` | Move ticket status (To Do → In Progress → Done) | `"move PROJ-42 to In Progress"` |
| `add_comment` | Comment on a ticket | `"add comment to PROJ-42: done and tested"` |
| `create_ticket` | Create a new Jira ticket | `"create a bug ticket in PROJ"` |
| `assign_ticket` | Assign ticket to a user | `"assign PROJ-42 to me"` |
| `log_work` | Log time spent | `"log 2h on PROJ-42"` |
| `get_create_meta` | Fetch required fields before creating a ticket | *(auto-called internally)* |
| `sync_offline_actions` | Retry queued actions from when offline | `"sync offline actions"` |

---

### 🔀 Git & Commits

| Tool | What it does | Say |
|------|-------------|-----|
| `get_recent_commits` | Git log with Jira linking, file diff stats, work area analysis | `"show my recent commits"` / `"what did I commit today?"` |
| `get_commit_details` | Full commit deep-dive: patch, files changed, lines +/-, Jira tickets | `"show changes in commit abc1234"` |

---

### 🎯 Daily Workflow

| Tool | What it does | Trigger |
|------|-------------|---------|
| `morning_standup` | Today's tickets, recent commits, priorities | Greeting: `"hi"`, `"good morning"`, `"start my day"` |
| `plan_my_day` | Deep plan: new/pending/blocked/overdue, comment context, code activity, yesterday's work | `"plan my day"` / `"what should I focus on today?"` |
| `end_of_day_report` | Generate + save EOD summary and session snapshot | `"end of day"` / `"EOD"` / `"wrap up"` |
| `get_daily_report` | Retrieve a saved report for a specific date | `"show report for 2024-01-15"` |
| `list_daily_reports` | Browse all saved daily reports | `"list my reports"` |
| `weekly_summary` | Weekly rollup across all work | `"weekly summary"` |
| `get_consolidated_summary` | Cross-project daily summary from all project folders | `"all projects today"` |

> **Reports** are saved per-project to `~/Documents/MobileTeamAgent/<ProjectName>/DD-MM-YYYY_updates.md`

---

### 🧠 Memory (Persistent Across Sessions)

| Tool | What it does | Say |
|------|-------------|-----|
| `remember` | Save a note (auto-links to ticket keys mentioned) | `"remember: use MMKV for token storage"` |
| `recall` | Search saved notes | `"what did I note about auth?"` |
| `recall_ticket` | Get all memory for a specific ticket | `"recall notes for PROJ-42"` |
| `journal` | Add a real-time work log entry | `"I just finished the login screen"` |
| `show_journal` | Show today's journal entries | `"show my journal"` |
| `add_decision` | Record a team decision that persists until resolved | `"we decided to use Zustand for state"` |
| `show_decisions` | List all active decisions | `"what decisions are pending?"` |
| `resolve_decision` | Mark a decision resolved | `"resolve decision about state management"` |
| `forget` | Delete a stored memory entry | `"forget that note"` |
| `memory_status` | Show memory usage stats | `"memory status"` |

#### 🔁 Session Snapshot (Next-Day Context)

At the end of every `end_of_day_report` and `plan_my_day`, the agent automatically saves a **session snapshot** to:

```
~/Documents/MobileTeamAgent/<ProjectName>/session_snapshot.md
```

It contains:
- 🟠 In-progress tickets (with last saved note)
- ✅ Completed today
- 📋 Pending / next up
- 🚫 Blocked tickets
- 💻 Today's commits
- 📓 Journal entries
- 🤝 Open decisions
- 🎯 Where to pick up tomorrow

When you say `"invoke mobile-team-agent"` or `"good morning"` next day, this snapshot is loaded automatically so Claude knows exactly where to pick up — no re-explaining needed.

---

### 🎨 Figma Design-to-Code

| Tool | What it does | Say |
|------|-------------|-----|
| `configure_figma` | One-time setup: save & validate Figma token | `"connect Figma"` / `"set up Figma"` |
| `figma_connection_test` | Verify saved token without reconfiguring | `"test Figma connection"` |
| `list_figma_screens` | List all top-level frames in a Figma file (names + dimensions) | `"show Figma screens"` / `"list frames"` |
| `read_figma_screen` | Full design data for one screen: text, colors, fills, auto-layout, padding, child hierarchy + PNG URL | `"read the Login screen"` / `"build the Home screen from Figma"` |
| `suggest_figma_screens` | Suggest screens not yet implemented in the project (5 at a time) | `"suggest screens to implement"` / `"next 5 screens"` |

> Always call `read_figma_screen` before writing code for a screen — it provides the real design data including colors, spacing, and hierarchy.

**Pagination for suggestions:**
```
"show 5 more"       → offset=5
"page 2"            → offset=10
"refresh screens"   → refresh=true
```

---

### ⚛️ React Native Project Setup

| Tool | What it does | Say |
|------|-------------|-----|
| `setup_rn_project` | Scaffold new RN or Expo project with TS, ESLint, Prettier, Jest, and opinionated library stack | `"set up a new RN project called MyApp"` / `"create an Expo app named ShopApp"` |
| `analyze_rn_architecture` | Audit existing RN project: missing folders, anti-patterns, installed libraries, architecture score | `"review my project structure"` / `"is my RN architecture correct?"` |
| `recommend_libraries` | Opinionated library recommendation for a feature with install command + minimal setup | `"what should I use for navigation?"` / `"recommend a library for auth"` |

**`setup_rn_project` parameters:**
- `name` — project name (e.g. `MyApp`)
- `type` — `cli` or `expo`
- `features` — any of: `navigation`, `state`, `networking`, `storage`, `forms`, `testing`, `ui`, `auth`, `analytics`, `crash`

**`recommend_libraries` feature keywords:**

| Keyword | Recommends |
|---------|-----------|
| `navigation` | React Navigation v7 / Expo Router v4 |
| `state` | Zustand / Redux Toolkit |
| `networking` | Axios + TanStack Query |
| `storage` | MMKV / AsyncStorage |
| `forms` | React Hook Form + Zod |
| `testing` | Jest + React Native Testing Library |
| `ui` | NativeWind / Gluestack UI |
| `auth` | Supabase Auth |
| `analytics` | Segment |
| `crash` | Sentry |

---

### 🔍 Code Review

| Tool | What it does | Say |
|------|-------------|-----|
| `review_branch` | Deep code review of current branch vs main. Detects RN issues, scores merge risk (LOW/MEDIUM/HIGH), lists must-fix and should-fix items, and **automatically checks which changed files are missing unit tests** | `"review my code"` / `"review my branch before PR"` |
| `compare_with_branch` | Merge readiness report: changed files, native changes (rebuild?), dependency changes, config changes, files by risk level, commit list | `"compare with main"` / `"what did I change?"` |
| `check_breaking_changes` | What could break on merge: major package bumps, deleted files, type changes, nav route changes, native code, service/store changes | `"will this break anything?"` / `"is it safe to merge?"` |
| `detect_rn_issues` | Scan a file or full branch diff for RN anti-patterns | `"scan for RN issues in LoginScreen.tsx"` / `"detect issues in my branch"` |

**What `detect_rn_issues` checks:**

| Severity | Category | Examples |
|----------|----------|---------|
| CRITICAL | Navigation | Untyped navigation calls (raw string routes) |
| CRITICAL | Async | AsyncStorage without await, async setState after unmount |
| CRITICAL | Promises | `.then()` without `.catch()` |
| HIGH | Hooks | `useEffect` with empty deps (stale closure), direct API in `useEffect` |
| HIGH | Lists | `FlatList` without `keyExtractor` |
| HIGH | Logs | `console.log/debug/info/verbose` left in code |
| HIGH | Errors | Empty `catch` blocks, `JSON.parse` without try-catch |
| HIGH | UX | Missing loading/error UI, async `onPress` without disabled state |
| HIGH | Placement | API calls directly in screen files |
| HIGH | Libraries | Raw `fetch()` instead of axios client, full `lodash` import, `moment.js` |
| MEDIUM | Styles | Inline style objects, hardcoded colors |
| MEDIUM | Types | TypeScript `any` type used |
| MEDIUM | Reuse | Magic numbers, duplicated string literals |
| MEDIUM | State | Multiple `setState` calls in one handler |
| MEDIUM | Lists | Missing empty state in `FlatList`/`ScrollView` |
| LOW | Typos | 30+ common spelling mistakes in identifiers/strings |
| LOW | Logic | Hardcoded booleans, unreachable code after return |
| LOW | Debt | TODO/FIXME comments |

**`review_branch` automatically includes a Unit Test Coverage check:**
- Scans every changed `.ts/.tsx/.js/.jsx` file for a matching test file
- Reports how many changed files have tests vs are missing tests
- Flags **CRITICAL** if none of the changed files have any tests
- Suggests `generate_unit_tests` inline if coverage gaps are found — no extra command needed

---

### 🧪 Unit Tests

| Tool | What it does | Say |
|------|-------------|-----|
| `generate_unit_tests` | Generate test files for changed files vs main. Auto-detects Jest/Vitest/Mocha, places tests correctly, runs them immediately | `"generate unit tests"` / `"generate tests for LoginScreen.tsx"` |
| `check_test_coverage` | Run full test suite with coverage, flag files below threshold | `"check test coverage"` / `"what's my coverage?"` |
| `run_tests` | Run the test suite or a specific file | `"run tests"` / `"run tests for LoginScreen"` |

**How `generate_unit_tests` works:**
1. Finds all changed `.ts/.tsx/.js/.jsx` files vs `main` (or a specific file you name)
2. Auto-detects your test framework from `package.json` (Jest → Vitest → Mocha)
3. Checks if a test file already exists — skips if so
4. Generates a test file with: render tests, snapshot, interaction tests (from `testID`s), async tests, hook tests, utility function tests
5. Runs the generated tests immediately and shows pass/fail
6. Asks you to fill in the `TODO` sections with real expected values

**Test file placement** — auto-detected from project structure:
- Co-located: `LoginScreen.test.tsx` next to `LoginScreen.tsx`
- Or in `__tests__/` folder if that pattern exists in the project

**Coverage thresholds** (`check_test_coverage`):
| Coverage | Status |
|----------|--------|
| 100% | ✅ Full |
| 80–99% | 🟡 Partial |
| 50–79% | 🟠 Low |
| < 50% | 🔴 CRITICAL — generate tests |

---

## 🛡 Change Safety Protocol

Every file change Claude makes goes through a mandatory safety flow:

### Before every edit
Claude states the risk level inline and proceeds immediately — no stopping:
```
🔍 Risk: 🟡 MEDIUM — modifying WorkflowSkill.js end_of_day_report output format
```

| Level | When |
|-------|------|
| 🟢 LOW | Docs, comments, README, non-functional text |
| 🟡 MEDIUM | Logic in one skill/tool, new optional param, new file |
| 🔴 HIGH | Tool signature change, shared service, `index.js`, `package.json`, CI/CD |

### After all edits are done
Claude provides a full impact summary:
- What changed and why
- What stays the same
- Side effects on other tools
- Automated test steps (`npm run validate`, `npm test`)
- Manual test steps (exact Claude CLI phrases to verify)
- Test cases table (happy path, edge case, failure case)

Then asks: **"Save to TESTING.md? And shall I commit?"** — and never commits without your explicit yes.

This protocol is enforced via `PreToolUse` and `PostToolUse` hooks installed into `~/.claude/settings.json` during setup.

---

## 💬 Natural Language Examples

```
# Morning
"Good morning"                            → morning standup + last session context
"plan my day"                             → deep daily plan

# Tickets
"show my tickets"                         → list open tickets
"show CMDN tickets"                       → project-specific tickets
"PROJ-42"                                 → full details + implementation plan
"what should I work on?"                 → AI-scored suggestions
"move PROJ-42 to In Progress"            → transition status
"log 3h on PROJ-42"                      → log work

# Git
"show my recent commits"                 → git log with Jira links
"what changed in commit abc1234"         → full patch details

# Figma
"show Figma screens"                     → list all frames
"build the Login screen from Figma"     → read design + generate code
"suggest next 5 screens to implement"   → unimplemented screen suggestions

# React Native
"set up a new RN project called TaskApp with navigation and auth"
"review my project structure"
"what should I use for state management?"

# Code Review
"review my branch"                       → full review with risk score
"will this break anything?"              → breaking change analysis
"scan LoginScreen.tsx for RN issues"    → file-level issue scan

# Unit Tests
"generate unit tests"                    → tests for all changed files, runs immediately
"check test coverage"                    → full coverage report
"run tests"                              → run the test suite

# Memory
"remember: auth token stored in MMKV"
"what did I note about auth?"
"I just finished the login screen"       → journal entry
"we decided to use Zustand"              → saved decision
"what decisions are pending?"

# End of day
"end of day"                             → EOD report + session snapshot saved
"weekly summary"                         → weekly rollup
```

---

## 📁 Project Structure

```
Mobile Team Agent/
├── Main/
│   ├── index.js            # MCP server entry point
│   └── SkillRegistry.js    # Tool registration
├── Skills/
│   ├── Core/BaseSkill.js
│   ├── SetupSkill.js         # invoke, get_setup_status, configure_service, health_check
│   ├── JiraReadSkill.js      # list_tickets, get_ticket_details, analyze_workload, ...
│   ├── JiraWriteSkill.js     # transition_ticket, add_comment, create_ticket, ...
│   ├── GitSkill.js           # get_recent_commits, get_commit_details
│   ├── WorkflowSkill.js      # morning_standup, plan_my_day, end_of_day_report, ...
│   ├── FigmaSkill.js         # configure_figma, list_figma_screens, read_figma_screen, ...
│   ├── MemorySkill.js        # remember, recall, journal, add_decision, ...
│   ├── CodeReviewSkill.js    # review_branch, detect_rn_issues, compare_with_branch, ...
│   ├── RNProjectSkill.js     # setup_rn_project, analyze_rn_architecture, recommend_libraries
│   ├── UnitTestSkill.js      # generate_unit_tests, check_test_coverage, run_tests
│   └── prompts/              # Markdown prompt templates per skill
├── Services/
│   ├── jira-client.js
│   ├── figma-client.js
│   ├── config-manager.js
│   ├── memory-manager.js     # includes session snapshot save/load
│   ├── report-manager.js
│   └── offline-queue.js
├── Constants/constants.js
├── Utils/
│   ├── git-utils.js
│   ├── ticket-utils.js
│   └── validators.js
├── setup.js                  # npx mobile-team-agent setup entry point
├── install.sh                # Clone-based installer
├── package.json
└── CLAUDE.md                 # Agent instructions for Claude
```

---

## 📊 Storage Layout

```
~/Documents/MobileTeamAgent/
├── MyApp/
│   ├── 31-07-2026_updates.md       ← EOD report
│   ├── 30-07-2026_updates.md
│   └── session_snapshot.md         ← next-day context (auto-updated)
├── ShopApp/
│   ├── 31-07-2026_updates.md
│   └── session_snapshot.md
```

`invoke_mobile_team` scans this folder on startup and surfaces all projects with their latest report date and session snapshot.

---

## 🛠 Troubleshooting

**Agent not responding to tools?**
```bash
npx mobile-team-agent setup   # re-register + refresh CLAUDE.md
claude mcp list               # verify registration
```

**CLAUDE.md not in my project?**
```bash
cd /path/to/your/project
npx mobile-team-agent setup   # writes CLAUDE.md into current directory
```

**Jira not connecting?**
```
"health check"                # run health_check tool
"configure Jira"              # re-run configure_service
```

**Hook blocking Claude mid-task?**
```bash
npx mobile-team-agent setup   # updates hooks to non-blocking version
```

**Manual MCP registration:**
```bash
claude mcp add mobile-team-agent -- node $(npm root -g)/mobile-team-agent/Main/index.js
```

---

## 🤝 Contributing

The repo is source-only. Install from npm or clone and run the installer. Do **not** commit `node_modules/`, `dist/`, `.env`, or `.DS_Store`.

To test locally:
```bash
npm run validate    # syntax-check all source files
npm start           # run the MCP server directly
```
