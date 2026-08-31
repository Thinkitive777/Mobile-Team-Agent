# 🚀 Mobile Team Agent

> **v4.0.0** — Context-aware, memory-driven developer assistant with Jira + Git integration, smart ticket guidance, persistent preferences, intelligent workflow automation, Figma design-to-code, React Native project setup, deep code review, pre-PR merge prediction with risk scoring, unit test generation, prompt validation, context engineering, and session memory across days.

The **Mobile Team Agent** is an MCP (Model Context Protocol) server that plugs into **Claude CLI**. It gives Claude a full suite of tools for mobile developers — Jira ticketing, Git insights, Figma design reading, RN project scaffolding, code review, pre-PR merge analysis, unit test generation, AI efficiency gating, and persistent memory — all accessible via natural language.

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

### 🎯 AI Efficiency & Prompt Validation
> *by Shekhar Manwar*

Runs before every other skill — it decides whether the agent has enough information to implement correctly, and keeps it from reading half the repo to find out.

| Tool | What it does | Say |
|------|-------------|-----|
| `analyze_request` | Validate a request before implementing: goal, scope, inputs, expected output, constraints, edge cases. Classifies missing info as CRITICAL / IMPORTANT / OPTIONAL and returns a READY / PARTIALLY READY / NEED CLARIFICATION verdict | `"check my prompt"` / `"is this enough information?"` / `/analyze <request>` |
| `narrow_code_scope` | Find the smallest relevant set of files for a feature or symbol, ranked, with the matched lines — so only those files get opened | `"where is end_of_day_report implemented"` / `/narrow biometric login` |
| `prompt_template` | The standard prompt structure (goal, context, scope, requirements, constraints, inputs, expected output, validation) | `"give me a prompt template"` / `/prompt add offline caching` |

**The gate the agent applies to every request:**

1. **Reuse context first** — conversation → project files → ticket → saved memory → config. Never asks for what it already has.
2. **Never assume** file names, API contracts, business rules, error handling, defaults, auth behaviour, data models, or supported versions.
3. **Classify the gap** — CRITICAL (stop and ask) / IMPORTANT (ask only if a wrong guess causes rework) / OPTIONAL (never blocks).
4. **Decide** — READY → implement; PARTIALLY READY → implement and state assumptions; NEED CLARIFICATION → one grouped question set, critical first.
5. **Narrow before reading** — feature → files → functions; change only what was asked.

Clear requests still run immediately — `"fix this function"` with the function attached is never turned into a questionnaire.

---

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
| `check_branch_sync` | Check the local branch against its remote before work starts — fetches refs (read-only), reports ahead/behind, and says when a `git pull` is needed. Never pulls *(by Shekhar Manwar)* | `"am I up to date?"` / `"is my branch synced?"` |
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

### 🚀 Pre-PR Check — Merge Prediction & Risk Scoring
> *by Devashish Kukade*

Run `pre_pr_check` before raising a pull request or to review an existing PR. It is **entirely read-only** — the working tree is never touched.

| Tool | What it does | Say |
|------|-------------|-----|
| `pre_pr_check` | Predict merge outcome, score risk 0–100, map feature impact, list conflicts | `"pre pr check into dev"` / `"check before I raise a PR"` / `/pre-pr dev` |
| `pre_pr_check` (PR mode) | Same checks on an existing PR — pass the link | `"review this PR: https://github.com/org/repo/pull/42"` / `/review-pr <link>` |

The tool reports four sections in priority order:

#### 1. Mergeable
Will the branch merge cleanly into the target? Uses `git merge-tree --write-tree` (requires git ≥ 2.38) to predict the merge in memory without touching any files.

#### 2. Risk Score — LOW / MEDIUM / HIGH (0–100)
A deterministic score where every point is explained. Nine weighted drivers, each capped so no single signal overwhelms:

| Driver | Points | Cap | What it catches |
|--------|--------|-----|-----------------|
| **Native code** | 25 | 25 | iOS/Android build inputs (Podfile, .gradle, Info.plist, AndroidManifest) — forces a clean rebuild |
| **Shared fan-in** | 2/dep | 20 | Shared files imported by 5+ other files — a one-line change that breaks six screens |
| **Dependency bumps** | 12/major | 25 | Major version bumps in package.json — APIs break by definition |
| **Test gap** | 3/file | 18 | Changed source files with no matching test file (disabled if project has < 3 test files) |
| **Migration/config** | 15 | 15 | Schema migrations, CI workflows, .env files, app config, build config |
| **Merge conflicts** | 2/file | 15 | Files that will not auto-merge |
| **Staleness** | 1/10 commits | 10 | How far behind the target branch this branch has drifted |
| **Fragile paths** | 5/file | 10 | Files that have been reverted or hot-fixed in recent history |
| **Churn** | 1/150 lines | 10 | Total lines changed (generated/lockfiles excluded) |

| Score | Band |
|-------|------|
| 0–29 | LOW |
| 30–59 | MEDIUM |
| 60–100 | HIGH |

Each driver includes evidence (file paths, importer counts, version bumps) and actionable mitigations.

#### 3. Features Impacted
Maps changed files to the project's feature structure (auto-detected from `src/domain`, `src/features`, `src/modules`, or `src/screens`):

- **Direct** — changed file lives inside a feature folder
- **Indirect** — changed file is shared code (services, redux, navigation); its importers are traced one hop to find which features are affected
- **App-wide** — shared code imported by 50+ files (reported separately)

Uses a reverse-import index built from the project's source files, honouring tsconfig path aliases.

#### 4. Conflicts
Exact list of files that will not auto-merge — fix these on your branch before opening the PR.

**Requirements:**
- Git ≥ 2.38 (for `git merge-tree --write-tree`)
- Not a shallow clone (merge-base would be wrong — run `git fetch --unshallow` first)
- `gh` CLI installed and authenticated (only for PR-mode via URL)

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

## 🔧 Build & Branch Sync Rules
> *by Shekhar Manwar*

**The agent never builds your project.** No `npm run build`, `expo prebuild`, `pod install`, `xcodebuild`, `gradlew`, or `run-ios`/`run-android` — when a build or native rebuild is needed it tells you and hands you the exact command. Running tests (`run_tests`, `generate_unit_tests`, `check_test_coverage`) is not a build and still happens automatically after development.

**The agent checks remote sync before it starts.** At session start, right after activation, it runs `check_branch_sync`:

| Result | What the agent does |
|--------|--------------------|
| In sync | Says the branch is up to date, then continues |
| Behind / diverged | Tells you to run `git pull` first and makes no edits until you have |
| No upstream | Says so and continues |

It never runs `git pull`, `git merge`, or `git rebase` itself — only a read-only fetch of remote-tracking refs.

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

## Slash Commands

Slash commands are **auto-installed** to `~/.claude/commands/` when you run `npx mobile-team-agent setup`. New commands from v4.0.0 use the `mta:` prefix to avoid conflicts with user commands.

**New in v4.0.0** (use `/mta:` prefix):

| Command | What it does | Author |
|---------|-------------|--------|
| `/mta:pre-pr <branch>` | Run `pre_pr_check` — first word is the branch to merge INTO | Devashish Kukade |
| `/mta:review-pr <link>` | Run `pre_pr_check` on an existing pull request URL | Devashish Kukade |
| `/mta:analyze <request>` | Validate a vague request before implementing | Shekhar Manwar |
| `/mta:narrow <feature>` | Find the smallest relevant set of files for a feature or symbol | Shekhar Manwar |
| `/mta:prompt <task>` | Show the standard prompt template | Shekhar Manwar |

**Existing commands** (no prefix change):

| Command | What it does |
|---------|-------------|
| `/standup` | Morning standup |
| `/eod` | End-of-day report |
| `/plan` | Deep daily plan |
| `/tickets` | List open tickets |
| `/ticket <key>` | Select a ticket |
| `/commits` | Recent git commits |
| `/remember` / `/recall` | Memory save/search |
| `/journal` | Work log entry |
| `/decide` / `/decisions` | Track decisions |
| `/suggest` | AI-scored ticket suggestions |
| `/weekly` | Weekly summary |
| `/workload` | Workload analysis |
| `/health` | Integration health check |
| `/status` | Setup status |
| `/memory` | Memory usage stats |

---

## Context Engineering (Optional Add-on)
> *by Aatif*

The `context-engineering/` folder contains an advanced Claude Code workflow system for long-running sessions. It is self-contained and can be adopted independently.

**What it provides:**
- **Slash commands:** `/checkpoint`, `/context`, `/handoff`, `/resume-handoff`, `/unknowns`
- **Hooks:** `git-guard.sh` (blocks destructive git ops), `pre-compact.sh`, `session-start.sh`, `statusline.js/sh` (live context usage %), `turn-context.js/sh`
- **Skills:** `context-handoff` — structured save/resume of task state across sessions
- **Docs:** 8-chapter guide (overview, getting started, commands, context engineering, git safety, model safety, reference, troubleshooting)

**Install:**
```bash
cd context-engineering
chmod +x install.sh && ./install.sh
```

**Key concepts:** Checkpoints (mid-task state save), Context Handoffs (persist across sessions), Unknowns tracking (unresolved decisions surfaced via `/unknowns`), Context budget bands (under 60% normal, 80%+ checkpoint recommended, 90%+ handoff strongly recommended), Git safety hooks.

**Team rules** in `context-engineering/CLAUDE.md`: no assumptions (label certainty as Known/Found/Inferred/Unknown), understand before you change, follow existing patterns, verify (never fake certainty), keep context small.

---

## Natural Language Examples

```
# Morning
"Good morning"                            -> morning standup + last session context
"plan my day"                             -> deep daily plan

# Tickets
"show my tickets"                         -> list open tickets
"PROJ-42"                                 -> full details + implementation plan
"what should I work on?"                 -> AI-scored suggestions
"move PROJ-42 to In Progress"            -> transition status

# Git
"show my recent commits"                 -> git log with Jira links
"am I up to date?"                       -> check branch sync status

# Pre-PR & Merge Safety
"pre pr check into dev"                  -> merge prediction + risk score
"review this PR: <github-link>"         -> review an existing PR by URL

# AI Efficiency
"check my prompt"                        -> analyze request completeness
"where is end_of_day_report"            -> narrow code scope

# Figma
"build the Login screen from Figma"     -> read design + generate code

# Code Review
"review my branch"                       -> full review with risk score
"scan LoginScreen.tsx for RN issues"    -> file-level issue scan

# Unit Tests
"generate unit tests"                    -> tests for all changed files

# Memory
"remember: auth token stored in MMKV"
"we decided to use Zustand"              -> saved decision

# End of day
"end of day"                             -> EOD report + session snapshot saved
```

---

## 📁 Project Structure

```
Mobile Team Agent/
├── Main/
│   ├── index.js              # MCP server entry point
│   └── SkillRegistry.js      # Tool registration
├── Skills/
│   ├── Core/BaseSkill.js
│   ├── EfficiencySkill.js    # analyze_request, narrow_code_scope, prompt_template
│   ├── SetupSkill.js         # invoke, get_setup_status, configure_service, health_check
│   ├── JiraReadSkill.js      # list_tickets, get_ticket_details, analyze_workload, ...
│   ├── JiraWriteSkill.js     # transition_ticket, add_comment, create_ticket, ...
│   ├── GitSkill.js           # get_recent_commits, get_commit_details, check_branch_sync
│   ├── WorkflowSkill.js      # morning_standup, plan_my_day, end_of_day_report, ...
│   ├── FigmaSkill.js         # configure_figma, list_figma_screens, read_figma_screen, ...
│   ├── MemorySkill.js        # remember, recall, journal, add_decision, ...
│   ├── CodeReviewSkill.js    # review_branch, detect_rn_issues, pre_pr_check, ...
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
├── Constants/constants.js    # version, risk weights, risk bands, timeouts
├── Utils/
│   ├── git-utils.js          # commit analysis + pre-PR merge plumbing + branch sync
│   ├── feature-map.js        # reverse-import index, feature impact analysis
│   ├── gh-utils.js           # GitHub CLI (gh) wrapper for PR metadata
│   ├── risk-model.js         # deterministic risk scoring (pure, no I/O)
│   ├── ticket-utils.js
│   └── validators.js
├── commands/                  # Slash commands (installed to ~/.claude/commands/ by setup)
│   ├── standup.md, eod.md, plan.md, tickets.md, ...  # existing
│   ├── mta:pre-pr.md         # /mta:pre-pr — pre-PR merge check
│   ├── mta:review-pr.md      # /mta:review-pr — review existing PR
│   ├── mta:analyze.md        # /mta:analyze — request validation
│   ├── mta:narrow.md         # /mta:narrow — code scope narrowing
│   └── mta:prompt.md         # /mta:prompt — prompt template
├── setup.js                  # npx mobile-team-agent setup entry point
├── install.sh                # Clone-based installer
├── package.json
└── CLAUDE.md                 # Agent instructions for Claude

.claude/commands/
├── pre-pr.md                 # /pre-pr slash command
├── review-pr.md              # /review-pr slash command
├── analyze.md                # /analyze slash command
├── narrow.md                 # /narrow slash command
└── prompt.md                 # /prompt slash command

context-engineering/           # Optional add-on (see Context Engineering section)
├── .claude/commands/          # /checkpoint, /context, /handoff, /resume-handoff, /unknowns
├── .claude/hooks/             # git-guard, pre-compact, session-start, statusline, turn-context
├── .claude/skills/            # context-handoff skill
├── docs/guide/                # 8-chapter documentation
├── install.sh                 # Self-contained installer
├── CLAUDE.md                  # Team engineering rules
└── README.md
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
