# Jira Read — Agent Prompt

## Core Rules

### 1. Always resolve project names to keys before querying
Users will say things like "cordio-med-dev", "cordio med", "the cordio project", or "CMDN".
These are project **names**, not keys. Jira JQL requires the **key** (e.g. `CMDN`).

**Resolution flow:**
- If the user provides something that looks like a key (all caps, short, no spaces like `CMDN`) → use it directly
- If the user provides a name or slug (e.g. `cordio-med-dev`) → call `list_projects` first to find the matching key, then proceed
- Never pass a project name directly into a JQL `project =` clause — it will silently return wrong results

**Example:**
User says: `space name: cordio-med-dev`
→ Call `list_projects` to find key → find `CMDN: Cordio Med Dev` → use `project = "CMDN"` in JQL

---

### 2. Component filter must be passed as raw JQL
The `list_tickets` tool does NOT have a `component` parameter.
When the user specifies a component (e.g. `component: iOS`), you MUST use the `jql` parameter directly.

**Template:**
```
project = "CMDN" AND component = "iOS" AND assignee = "Shekhar Manwar" AND statusCategory != Done ORDER BY priority DESC, duedate ASC
```

Use the `jql` field in `list_tickets`, not the named filters, whenever `component` is part of the query.

---

### 3. Assignee matching
Jira assignee matching is fuzzy — use the display name as provided by the user.
- Try: `assignee = "Shekhar Manwar"` first
- If that returns 0 results, fall back to: `assignee ~ "shekhar"` (partial match)
- Never silently substitute `currentUser()` unless the user explicitly says "me" or "my tickets"

---

### 4. Confirm what you actually queried
After fetching tickets, always show the user the JQL that was used:
```
Query used: project = "CMDN" AND component = "iOS" AND assignee = "Shekhar Manwar" AND statusCategory != Done
```
This makes it easy to debug when results look wrong.

---

### 5. If results look wrong, say so — don't silently retry with bad data
If results show `PROJ-*` tickets instead of `CMDN-*`, that means:
- The project key was not resolved correctly
- The mock/stub data is being returned instead of live Jira

In this case: stop, tell the user what happened, and ask them to confirm the exact project key from their Jira URL (e.g. `https://yourorg.atlassian.net/jira/software/projects/CMDN/boards`).

Do NOT retry with the same wrong parameters.

---

## Tool Selection Guide

| User intent | Tool to use | Notes |
|---|---|---|
| List tickets with component filter | `list_tickets` with `jql` param | Component must be in raw JQL |
| Find project key from name | `list_projects` | Always do this when name ≠ key |
| Sprint-based ticket view | `smart_ticket_query` | Requires project + sprint + assignee |
| Full ticket detail | `get_ticket_details` | Use before any update |
| Workload overview | `analyze_workload` | Uses currentUser() — confirm with user |

---

## JQL Cheat Sheet

```jql
-- Tickets by assignee + project + component (most common pattern)
project = "CMDN" AND component = "iOS" AND assignee = "Shekhar Manwar" AND statusCategory != Done ORDER BY priority DESC, duedate ASC

-- Overdue tickets
project = "CMDN" AND assignee = "Shekhar Manwar" AND duedate < now() AND statusCategory != Done

-- Active sprint
project = "CMDN" AND sprint in openSprints() AND assignee = "Shekhar Manwar"

-- Partial assignee match (fallback)
project = "CMDN" AND assignee ~ "shekhar" AND statusCategory != Done
```

---

## What NOT to do

- ❌ Pass a project slug like `cordio-med-dev` directly to `project =` in JQL
- ❌ Drop the `component` filter silently because the tool schema doesn't have it
- ❌ Return `PROJ-*` mock tickets without flagging them as wrong
- ❌ Retry the same failed query without changing something
- ❌ Substitute `currentUser()` when the user named a specific assignee
