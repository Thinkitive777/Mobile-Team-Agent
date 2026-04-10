# Project Guide Agent — Test Plan

## How to Use This File

This file defines manual test cases for every feature of the Project Guide Agent.
When the user says **"test the functionality"**, follow this plan.

### Rules

1. **Read this file first** before running any test.
2. **Single feature test**: User says `test <feature_name>` — run only that section.
3. **Full test suite**: User says `test all` — run every section in order, top to bottom.
4. **Test environment**: Create a temporary folder `~/Desktop/testAgent/` for each test run. Clean it up after all tests pass.
5. **Pass/Fail reporting**: After each test, print a result line in this exact format:
   ```
   [PASS] <test_name> — <short description>
   [FAIL] <test_name> — <what went wrong>
   ```
6. **Final summary**: After all tests, print a summary table:
   ```
   ══════════════════════════════════════
   TEST RESULTS SUMMARY
   ══════════════════════════════════════
   Passed: X / Y
   Failed: Z / Y
   ──────────────────────────────────────
   [PASS] test_name_1
   [FAIL] test_name_2 — reason
   ══════════════════════════════════════
   ```
7. **Do not skip tests** that fail — continue to the next test and report the failure.
8. **Jira-dependent tests**: If Jira is not configured, mark those tests as `[SKIP] — Jira not connected` and do not count them as failures.
9. **Git-dependent tests**: Run from a git repository. If not in one, mark as `[SKIP] — not a git repo`.

---

## Pre-Test Setup

Before running any tests, execute these setup checks:

### Step 1: Verify modules load
```
cd "Project Guide Agent" && node -e "
const CM = require('./Services/config-manager');
const SR = require('./Main/SkillRegistry');
const skills = [
  require('./Skills/SetupSkill'),
  require('./Skills/JiraReadSkill'),
  require('./Skills/JiraWriteSkill'),
  require('./Skills/WorkflowSkill'),
  require('./Skills/GitSkill'),
  require('./Skills/LegacySkill'),
];
const reg = new SR();
skills.forEach(S => reg.register(new S()));
const tools = reg.getAllTools();
console.log('Modules: OK (' + tools.length + ' tools)');
console.log('Tools: ' + tools.map(t => t.name).join(', '));
"
```
**Expected**: `Modules: OK (32 tools)` and all 32 tool names listed.

### Step 2: Check Jira connectivity
```
Call: health_check
```
**Expected**: Returns JSON with `jira.status`, `git.status`, `reports.status`. Note which are `"ok"` vs `"error"` — this determines which tests can run.

### Step 3: Create test workspace
```bash
mkdir -p ~/Desktop/testAgent && cd ~/Desktop/testAgent && git init
```

---

## Test Cases

---

### TEST 01: module_loading
**What**: All JS modules load without errors and all 32 tools register.
**Steps**:
1. Run the Step 1 command from Pre-Test Setup above.
2. Verify output says `Modules: OK (32 tools)`.
3. Verify all these tools are listed: `invoke_projectguide`, `get_setup_status`, `configure_service`, `switch_jira_project`, `jira_connection_test`, `health_check`, `set_preferences`, `fetch_jira_tickets`, `get_ticket_details`, `analyze_workload`, `list_projects`, `list_sprints`, `smart_ticket_query`, `get_ticket_suggestions`, `select_ticket`, `list_tickets`, `transition_ticket`, `add_comment`, `assign_ticket`, `create_ticket`, `get_create_meta`, `search_users`, `log_work`, `morning_standup`, `end_of_day_report`, `get_daily_report`, `list_daily_reports`, `weekly_summary`, `get_consolidated_summary`, `get_recent_commits`, `sync_offline_actions`, `run_skill`.
**Pass if**: All 32 tools registered, no errors.

---

### TEST 02: invoke_projectguide
**What**: Agent activation reports correct status.
**Steps**:
1. Call `invoke_projectguide`.
2. Verify response contains `Project Guide Agent v` and a version number.
3. If Jira is connected: response should say `All services connected`.
4. If Jira is NOT connected: response should say `Setup required: Jira`.
**Pass if**: Version shown, connection status matches reality.

---

### TEST 03: get_setup_status
**What**: Setup status shows connections, preferences, and reports.
**Steps**:
1. Call `get_setup_status`.
2. Verify response contains all these sections: `--- Connections ---`, `--- Preferences (persistent) ---`, `--- Reports ---`.
3. Verify Jira status line matches actual connectivity.
4. Verify preferences show current saved values.
**Pass if**: All 3 sections present, values match reality.

---

### TEST 04: health_check
**What**: Health check tests all integrations.
**Steps**:
1. Call `health_check`.
2. Verify response contains JSON with keys: `version`, `timestamp`, `jira`, `git`, `reports`.
3. Each integration has a `status` field (`"ok"` or `"error"`).
4. If all OK: header says `ALL OK`. If any fail: header says `ISSUES DETECTED`.
**Pass if**: JSON structure correct, header matches statuses.

---

### TEST 05: set_preferences
**What**: Preferences save and persist across calls.
**Steps**:
1. Call `set_preferences` with `greeting_name = "TestUser"`.
2. Verify response says `Preferences updated: greeting name: TestUser`.
3. Call `set_preferences` with no arguments.
4. Verify response shows `Greeting Name: TestUser`.
5. Call `set_preferences` with `greeting_name = "Shekhar"` to restore original.
**Pass if**: Preference saved, recalled correctly, restored.

---

### TEST 06: morning_standup
**What**: Morning standup triggers on greeting messages and shows tickets + commits + plan.
**Requires**: Jira connected (skip if not).
**Steps**:
1. Prompt: `Good morning`
   - Verify `morning_standup` tool is called.
   - Verify response contains `Morning Standup —` with today's date.
2. Prompt: `Hi`
   - Verify `morning_standup` tool is called.
3. Prompt: `Start my day`
   - Verify `morning_standup` tool is called.
4. Verify response includes at least one of: `Workload:`, `No pending tickets`, or `[Jira unavailable`.
5. Verify response ends with `hat would you like to work on today?`.
**Pass if**: All 3 prompts trigger standup, output has correct structure.

---

### TEST 07: morning_standup_without_jira
**What**: Standup works gracefully when Jira is unavailable.
**Steps**:
1. Call `morning_standup` (even if Jira is disconnected).
2. Verify response contains `Morning Standup —`.
3. If Jira is disconnected: verify `[Jira unavailable` appears.
4. Verify no crash or error response (isError should be false).
**Pass if**: Graceful degradation, no crash.

---

### TEST 08: end_of_day_report
**What**: EOD report generates and saves to Desktop.
**Steps**:
1. Prompt: `provide my updates`
   - Verify `end_of_day_report` tool is called (NOT `run_skill`).
2. Prompt: `end of day`
   - Verify `end_of_day_report` tool is called.
3. Prompt: `daily updates`
   - Verify `end_of_day_report` tool is called.
4. Verify response contains `Daily Updates —` with today's date.
5. Verify file was saved at `~/Desktop/Todays Updates/DD-MM-YYYY_updates.md`.
6. Verify file contains sections: `Tickets Completed Today`, `Tasks Performed`, `Pending Tasks`, `Notes`.
**Pass if**: All 3 prompts trigger EOD, file saved with correct format.

---

### TEST 09: end_of_day_no_activity
**What**: EOD report handles no activity gracefully.
**Steps**:
1. Create a fresh git repo: `mkdir -p ~/Desktop/testAgent && cd ~/Desktop/testAgent && git init`.
2. Call `end_of_day_report` from that directory (no commits, no Jira activity).
3. If Jira is disconnected and no commits: verify response says `No updates for today. Would you like to pick up a task?`.
**Pass if**: No crash, graceful empty-day message.

---

### TEST 10: get_recent_commits
**What**: Git commits are fetched with ticket ID linking.
**Requires**: Running inside a git repo with commits.
**Steps**:
1. Call `get_recent_commits` with `since = "7 days ago"`.
2. If commits exist: verify response shows `Recent Commits` with hash, message, author, datetime.
3. If no commits: verify response says `No commits found since`.
4. If a commit message contains a ticket ID (e.g., `PROJ-123`): verify `Tickets:` line appears.
**Pass if**: Commits listed or "no commits" message, no crash.

---

### TEST 11: list_projects
**What**: Lists all accessible Jira projects.
**Requires**: Jira connected.
**Steps**:
1. Call `list_projects`.
2. Verify response contains `Available Projects (`.
3. Verify each project shows `KEY: Name` format.
4. If a preferred project is set: verify `(current)` marker appears next to it.
**Pass if**: Projects listed in correct format.

---

### TEST 12: list_sprints
**What**: Lists sprints for a project.
**Requires**: Jira connected, a project with boards.
**Steps**:
1. Call `list_sprints` with a known `project_key`.
2. Verify response contains `Sprints for <key>:`.
3. Verify active sprints show `[ACTIVE]` tag.
4. If no sprints: verify helpful message returned.
**Pass if**: Sprints listed or helpful "no sprints" message.

---

### TEST 13: list_tickets
**What**: Flexible ticket search with smart defaults.
**Requires**: Jira connected.
**Steps**:
1. Call `list_tickets` with no arguments (should default to `assignee = currentUser()`).
2. Verify response shows `Prioritized Ticket List:` or `No tickets found`.
3. Call `list_tickets` with `status = "In Progress"`.
4. Verify all returned tickets have status `In Progress`.
5. Call `list_tickets` with `priority = "High,Highest"`.
6. Verify all returned tickets have High or Highest priority.
**Pass if**: Default query works, filters applied correctly.

---

### TEST 14: list_tickets_project_name_resolution
**What**: list_tickets resolves project names (not just keys).
**Requires**: Jira connected.
**Steps**:
1. Call `list_tickets` with `project = "<a known project name>"` (full name, not key).
2. Verify the project name is resolved to a key and tickets are returned from the correct project.
3. Call `list_tickets` with `project = "nonexistent-project-xyz"`.
4. Verify an error message lists available projects.
**Pass if**: Name resolution works, bad name gives helpful error.

---

### TEST 15: fetch_jira_tickets
**What**: Raw JQL query support.
**Requires**: Jira connected.
**Steps**:
1. Call `fetch_jira_tickets` with `jql = "assignee = currentUser() ORDER BY updated DESC"`.
2. Verify response shows categorized tickets by issue type.
3. Call `fetch_jira_tickets` with `assignee = "currentUser"` and `status = "In Progress"`.
4. Verify tickets are filtered correctly.
**Pass if**: JQL passthrough works, filter-based query works.

---

### TEST 16: get_ticket_details
**What**: Full ticket details with description, comments, subtasks, links, changelog.
**Requires**: Jira connected, a known ticket key.
**Steps**:
1. Call `get_ticket_details` with a valid `ticket_key` (e.g., `PROJ-1`).
2. Verify response contains: key, summary, status, priority, assignee, description.
3. If ticket has comments: verify `Comments` section appears.
4. If ticket has subtasks: verify `Subtasks` section appears.
5. Call `get_ticket_details` with `ticket_key = "invalid"`.
6. Verify error response about invalid format.
**Pass if**: Full details shown for valid key, validation error for invalid key.

---

### TEST 17: smart_ticket_query
**What**: Categorized ticket query requiring project, sprint, assignee.
**Requires**: Jira connected, project + sprint set in preferences.
**Steps**:
1. Call `smart_ticket_query` with `project`, `sprint`, `assignee = "currentUser"`.
2. Verify response shows tickets categorized by type (Bugs, Stories, Tasks, etc.).
3. Call `smart_ticket_query` with no arguments and no preferences set.
4. Verify response asks for missing details.
**Pass if**: Categorized output when params given, helpful prompt when missing.

---

### TEST 18: select_ticket
**What**: Select a ticket and get implementation plan.
**Requires**: Jira connected, a known ticket key.
**Steps**:
1. Call `select_ticket` with a valid `ticket_key`.
2. Verify response contains: `Selected Ticket:`, description, and implementation guidance.
3. If ticket has subtasks: verify subtask checklist appears with `[x]`/`[ ]` markers.
**Pass if**: Full ticket view with implementation plan shown.

---

### TEST 19: get_ticket_suggestions
**What**: AI-scored ticket recommendations.
**Requires**: Jira connected, tickets assigned to current user.
**Steps**:
1. Call `get_ticket_suggestions`.
2. Verify response contains `Ticket Suggestions` and `Top Recommendations`.
3. Verify top tickets are sorted by score (overdue, high priority, in-progress first).
4. If no tickets: verify `You're all caught up!` message.
**Pass if**: Scored recommendations shown or "all caught up" message.

---

### TEST 20: analyze_workload
**What**: Categorizes tickets into Done, In Progress, Not Started, Blocked, Overdue.
**Requires**: Jira connected.
**Steps**:
1. Call `analyze_workload`.
2. Verify response contains `Workload Analysis` header.
3. Verify all 5 categories are listed: `Done`, `In Progress`, `Not Started`, `Blocked`, `Overdue`.
4. Verify `--- Insights ---` section appears.
5. If overdue tickets exist: verify `OVERDUE:` line with ticket keys and due dates.
**Pass if**: All categories shown, insights section present.

---

### TEST 21: transition_ticket
**What**: Move a ticket to a new status.
**Requires**: Jira connected, a ticket the user can transition.
**Steps**:
1. Call `transition_ticket` with `ticket_key` and NO `status`.
2. Verify response lists available transitions (e.g., `"Start" → In Progress`).
3. Call `transition_ticket` with `ticket_key` and `status = "In Progress"`.
4. Verify response says `moved to "In Progress"`.
5. Transition it back to the original status to avoid side effects.
**Pass if**: Available transitions listed, transition succeeds and reports new status.

---

### TEST 22: add_comment
**What**: Add a comment to a Jira ticket.
**Requires**: Jira connected, a known ticket key.
**Steps**:
1. Call `add_comment` with `ticket_key` and `comment = "[Test] Automated test comment — safe to delete"`.
2. Verify response says `Comment added to <key> by <author>`.
3. Call `add_comment` with `ticket_key` and empty `comment`.
4. Verify error response says comment text is required.
**Pass if**: Comment added successfully, empty comment rejected.

---

### TEST 23: create_ticket
**What**: Create a new Jira ticket.
**Requires**: Jira connected, a valid project key.
**Steps**:
1. Call `create_ticket` with `summary = "[Test] Auto-created ticket — safe to delete"`, `project = "<key>"`, `type = "Task"`.
2. Verify response says `Ticket created: <NEW-KEY>` with a Jira browse link.
3. Call `create_ticket` with no summary.
4. Verify error response says summary is required.
**Note**: Delete the test ticket manually after testing.
**Pass if**: Ticket created with key returned, missing summary rejected.

---

### TEST 24: assign_ticket
**What**: Assign a ticket to a user.
**Requires**: Jira connected.
**Steps**:
1. Call `assign_ticket` with `ticket_key` and `assign_to_me = true`.
2. Verify response says `<key> assigned to <accountId>`.
3. Call `assign_ticket` with `ticket_key` only (no account_id, no assign_to_me).
4. Verify error response asks for account_id or assign_to_me.
**Pass if**: Self-assignment works, missing ID gives helpful error.

---

### TEST 25: search_users
**What**: Search for Jira users by name or email.
**Requires**: Jira connected.
**Steps**:
1. Call `search_users` with `query = "<your name or email>"`.
2. Verify response lists users with `displayName`, `Account ID`.
3. Call `search_users` with `query = "zzz_nonexistent_user_xyz"`.
4. Verify response says `No users found`.
**Pass if**: Users found for valid query, empty result for nonsense query.

---

### TEST 26: log_work
**What**: Log time on a Jira ticket.
**Requires**: Jira connected, a ticket key.
**Steps**:
1. Call `log_work` with `ticket_key` and `time_spent = "1m"`.
2. Verify response says `Logged 1m on <key>`.
3. Call `log_work` with `ticket_key` and empty `time_spent`.
4. Verify error response says time_spent is required.
**Pass if**: Work logged, missing time rejected.

---

### TEST 27: get_create_meta
**What**: Fetch required fields for ticket creation.
**Requires**: Jira connected.
**Steps**:
1. Call `get_create_meta` with `project = "<key>"` and `type = "Task"`.
2. Verify response contains `--- Required Fields ---` and `--- Optional Fields ---`.
3. Call `get_create_meta` with `project = "<key>"` and `type = "NonexistentType"`.
4. Verify error lists available issue types.
**Pass if**: Fields listed for valid type, available types shown for invalid type.

---

### TEST 28: get_daily_report
**What**: Retrieve a previously saved daily report.
**Steps**:
1. First, call `end_of_day_report` to ensure today's report exists.
2. Call `get_daily_report` with `date = "<today YYYY-MM-DD>"`.
3. Verify the report content is returned.
4. Call `get_daily_report` with `date = "2020-01-01"`.
5. Verify error says `No report found for 2020-01-01`.
6. Call `get_daily_report` with `date = "not-a-date"`.
7. Verify validation error about date format.
**Pass if**: Existing report returned, missing date handled, bad format rejected.

---

### TEST 29: list_daily_reports
**What**: List all saved reports with optional date range.
**Steps**:
1. Call `list_daily_reports` with no arguments.
2. Verify response lists reports (or says `No daily reports found`).
3. If reports exist: verify each line shows `YYYY-MM-DD: X completed, Y commits`.
**Pass if**: Reports listed or "none found" message.

---

### TEST 30: weekly_summary
**What**: Weekly rollup of daily reports.
**Steps**:
1. Call `weekly_summary` with no arguments (defaults to last 7 days).
2. Verify response contains `Weekly Summary` header.
3. Verify sections: `Overview`, `Completed This Week`, `Still In Progress`, `Blockers Encountered`.
4. If no reports exist for the week: verify `No reports found for this week.`.
**Pass if**: Summary structure correct or "no reports" message.

---

### TEST 31: get_consolidated_summary
**What**: Cross-project daily summary.
**Steps**:
1. Call `get_consolidated_summary` with no arguments (defaults to today).
2. Verify response contains `Consolidated Summary`.
3. If project reports exist: verify `Per-Project Breakdown` section.
4. If no project reports: verify `No project reports found` message.
**Pass if**: Summary generated or "no reports" message.

---

### TEST 32: switch_jira_project
**What**: Switch active Jira project credentials.
**Steps**:
1. Call `switch_jira_project` with no `project_name`.
2. Verify response lists configured projects (or says `No Jira projects configured`).
3. If multiple projects are configured: call `switch_jira_project` with a valid `project_name`.
4. Verify response says `Switched to Jira project: <name>`.
**Pass if**: Project list shown or switch confirmed.

---

### TEST 33: configure_service_validation
**What**: Configure service validates inputs.
**Steps**:
1. Call `configure_service` with `service = "jira"`, `url = "not-a-url"`, `email = "test@test.com"`, `token = "abc"`.
2. Verify error about Jira URL (must be HTTPS).
3. Call `configure_service` with `service = "jira"`, `url = "https://test.atlassian.net"`, `email = "not-an-email"`, `token = "abc"`.
4. Verify error about invalid email.
5. Call `configure_service` with `service = "jira"`, `url = "https://test.atlassian.net"`, `email = "test@test.com"`, `token = "********"`.
6. Verify error about masked/placeholder token.
7. Call `configure_service` with `service = "jira"`, `url = "https://test.atlassian.net"`, `email = "test@test.com"`, `token = "short"`.
8. Verify error about token being too short.
**Important**: Do NOT call with valid credentials unless you intend to reconfigure — it will overwrite the current config.
**Pass if**: All 4 validation errors returned correctly.

---

### TEST 34: jira_connection_test
**What**: Validate Jira credentials.
**Requires**: Jira connected.
**Steps**:
1. Call `jira_connection_test`.
2. Verify response contains `Jira connection successful` with `User:`, `Email:`, `Account:`.
**Pass if**: User info returned.

---

### TEST 35: sync_offline_actions
**What**: Replay queued offline actions.
**Steps**:
1. Call `sync_offline_actions`.
2. If queue is empty: verify response says `No offline actions in queue.`.
3. If queue has items: verify each action reports success or failure.
**Pass if**: Empty queue handled, or actions replayed with status.

---

### TEST 36: run_skill_routing
**What**: run_skill correctly routes to real tools or rejects unknown skills.
**Steps**:
1. Call `run_skill` with `skill = "projects"`.
2. Verify response says `maps to the tool "list_projects"` and tells user to call it directly.
3. Call `run_skill` with `skill = "developer-mode"`.
4. Verify response toggles developer mode and shows new state.
5. Call `run_skill` with `skill = "developer-mode"` again to toggle back.
6. Call `run_skill` with `skill = "unknown-skill-xyz"`.
7. Verify error response says `Unknown skill`.
**Pass if**: Routing works, developer-mode toggles, unknown rejected.

---

### TEST 37: base_skill_response_helpers
**What**: BaseSkill textResponse/errorResponse inherited by all skills.
**Steps**:
1. Run:
   ```
   node -e "
   const BaseSkill = require('./Skills/Core/BaseSkill');
   const bs = new BaseSkill();
   const t = bs.textResponse('hello');
   const e = bs.errorResponse('oops');
   console.log('text:', JSON.stringify(t));
   console.log('error:', JSON.stringify(e));
   console.log('PASS:', t.content[0].text === 'hello' && e.isError === true && e.content[0].text === 'oops');
   "
   ```
2. Verify output shows `PASS: true`.
**Pass if**: Both helpers return correct MCP format.

---

### TEST 38: ticket_utils_shared
**What**: isTicketBlocked utility works from shared location.
**Steps**:
1. Run:
   ```
   node -e "
   const { isTicketBlocked } = require('./Utils/ticket-utils');
   const blocked1 = isTicketBlocked({ summary: 'blocked task', status: 'Open', labels: [], issueLinks: [] });
   const blocked2 = isTicketBlocked({ summary: 'normal task', status: 'Open', labels: ['blocked'], issueLinks: [] });
   const blocked3 = isTicketBlocked({ summary: 'normal task', status: 'Open', labels: [], issueLinks: [{ description: 'is blocked by', linkedStatus: 'Open' }] });
   const notBlocked = isTicketBlocked({ summary: 'normal task', status: 'Open', labels: [], issueLinks: [] });
   console.log('name-blocked:', blocked1);
   console.log('label-blocked:', blocked2);
   console.log('link-blocked:', blocked3);
   console.log('not-blocked:', notBlocked);
   console.log('PASS:', blocked1 && blocked2 && blocked3 && !notBlocked);
   "
   ```
2. Verify output shows `PASS: true`.
**Pass if**: All 4 scenarios produce correct boolean.

---

### TEST 39: config_manager_exports
**What**: ConfigManager exports all required functions and state.
**Steps**:
1. Run:
   ```
   node -e "
   const CM = require('./Services/config-manager');
   const keys = ['config', 'preferences', 'saveConfig', 'savePreferences', 'getJiraClient', 'getRepoPath', 'maskToken', 'isTokenMasked'];
   const missing = keys.filter(k => CM[k] === undefined);
   console.log('Exports:', Object.keys(CM).join(', '));
   console.log('Missing:', missing.length === 0 ? 'none' : missing.join(', '));
   console.log('maskToken test:', CM.maskToken('abcdefghij') === 'tok_****ghij');
   console.log('isTokenMasked test:', CM.isTokenMasked('********') === true && CM.isTokenMasked('real-token') === false);
   console.log('PASS:', missing.length === 0);
   "
   ```
2. Verify output shows `PASS: true`, correct mask output, correct masked detection.
**Pass if**: All exports present, maskToken and isTokenMasked work.

---

### TEST 40: file_documentation_headers
**What**: Every JS source file has a `/// MARK:` documentation header.
**Steps**:
1. Run:
   ```bash
   for f in Main/index.js Main/SkillRegistry.js Constants/constants.js \
     Services/config-manager.js Services/jira-client.js Services/offline-queue.js Services/report-manager.js \
     Skills/Core/BaseSkill.js Skills/SetupSkill.js Skills/JiraReadSkill.js Skills/JiraWriteSkill.js \
     Skills/WorkflowSkill.js Skills/GitSkill.js Skills/LegacySkill.js \
     Utils/errors.js Utils/git-utils.js Utils/logger.js Utils/validators.js Utils/ticket-utils.js; do
     if head -1 "$f" | grep -q "/// MARK:"; then
       echo "[OK] $f"
     else
       echo "[MISSING] $f"
     fi
   done
   ```
2. Verify all files show `[OK]`.
**Pass if**: Every file has the `/// MARK:` header.

---

## Quick Reference: Test by Feature Name

| Feature | Test ID(s) |
|---------|------------|
| module loading | TEST 01 |
| invoke / activation | TEST 02 |
| setup status | TEST 03 |
| health check | TEST 04 |
| preferences | TEST 05 |
| morning standup | TEST 06, 07 |
| end of day / updates | TEST 08, 09 |
| git commits | TEST 10 |
| list projects | TEST 11 |
| list sprints | TEST 12 |
| list tickets | TEST 13, 14 |
| fetch jira tickets | TEST 15 |
| ticket details | TEST 16 |
| smart ticket query | TEST 17 |
| select ticket | TEST 18 |
| ticket suggestions | TEST 19 |
| analyze workload | TEST 20 |
| transition ticket | TEST 21 |
| add comment | TEST 22 |
| create ticket | TEST 23 |
| assign ticket | TEST 24 |
| search users | TEST 25 |
| log work | TEST 26 |
| get create meta | TEST 27 |
| get daily report | TEST 28 |
| list daily reports | TEST 29 |
| weekly summary | TEST 30 |
| consolidated summary | TEST 31 |
| switch project | TEST 32 |
| configure service | TEST 33 |
| jira connection test | TEST 34 |
| sync offline | TEST 35 |
| run skill | TEST 36 |
| base skill helpers | TEST 37 |
| ticket utils | TEST 38 |
| config manager | TEST 39 |
| file headers | TEST 40 |
| **all** | TEST 01–40 |

---

## Figma Connect — Live & Mocked Test Results

Verified against Figma file `iOS - Practice App` (key `NSYiGQYsupMMc3VUHxQkuy`)
and `~/Desktop/Demo Folder` on 2026-04-10. All 16 cases pass.

| #  | Scenario                                                       | Result                                                              |
|----|----------------------------------------------------------------|---------------------------------------------------------------------|
| 1  | `configure_figma {}` (not connected)                           | Setup guide, `isError=false`                                        |
| 2  | `figma_connection_test` (not configured)                       | Setup guide, `isError=false`                                        |
| 3  | `list_figma_screens` (not configured)                          | Setup guide, `isError=true`                                         |
| 4  | `configure_figma {token: "tooshort"}`                          | Validation error + setup guide                                      |
| 5  | `configure_figma {token: real}`                                | Connected as Shekhar Manwar (live API)                              |
| 6  | `configure_figma {}` after connect                             | "Already connected" status (no re-prompt)                           |
| 7  | `configure_figma {force:true}` (no token)                      | Setup guide (lets user reconfigure)                                 |
| 8  | `list_figma_screens` (real file)                               | 2 screens read from `iOS - Practice App`                            |
| 9  | `suggest_figma_screens` against Demo Folder                    | Empty-scan WARNING + 2 suggestions                                  |
| 10 | `suggest_figma_screens project_path=/tmp/none`                 | Clean error: "Project path does not exist"                          |
| 11 | `suggest_figma_screens` with mock 1 matching file              | Correctly filtered Login Screen, returned 1 unimplemented           |
| 12 | `suggest_figma_screens offset=999`                             | Cleanly returns "no more suggestions"                               |
| 13 | Empty Figma file (no frames)                                   | Friendly "no top-level frames. Add FRAME nodes."                    |
| 14 | Token revocation mid-session                                   | Auto-clears `connected=false`, asks for fresh token + guide         |
| 15 | Bogus `retry-after: 397851` (≈110 hours)                       | Bails in <100 ms with `FIGMA_RATE_LIMIT` (instead of hanging)       |
| 16 | Rollback on token validation failure                           | Previous token preserved, not overwritten                           |

### Live verification snippets

**Setup guide on first contact (Case 1)**
```
How to connect Figma

Figma Connect uses a personal access token (read scope is enough).
...
STEP 1 — Open your Figma account settings
   • Sign in at https://www.figma.com
   • Click your avatar (top-left) → "Settings"
   • Open the "Security" tab

STEP 2 — Generate a personal access token
   • Scroll to "Personal access tokens"
   • Click "Generate new token"
   • Scopes: "File content" → Read is sufficient
   • Token format looks like:  figd_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
...
```

**Already-connected awareness (Case 6)**
```
Figma is already connected.
Connected as: Shekhar Manwar
Token: tok_****kEpV

You can use 'list_figma_screens' or 'suggest_figma_screens' right away.
```

**Empty-scan warning (Case 9)**
```
WARNING: Scanned /Users/mac/Desktop/Demo Folder but found 0 source files
(.swift/.kt/.dart/.tsx/...). Either the project is empty, only contains
binaries/assets, or this process lacks read permission. All Figma screens
will be reported as "not implemented" until source files are present.

Suggestions from "iOS - Practice App"...
Total unimplemented: 2 (Figma total: 2)
```

**Rate-limit hang fix (Case 15)** — bug found during live testing where
Figma's `retry-after` header returned `397851` seconds (~110 hours). The
client now caps the wait at 30 s and bails immediately on absurd values:
```
{"level":"warn","msg":"Figma rate limited","data":{"rawRetry":397601,"willWaitSec":30}}
FIGMA_RATE_LIMIT Figma API rate limit exceeded (server requested 397601s wait). Try again in a minute.
```
Total time: <100 ms (was: ~110 hours).
