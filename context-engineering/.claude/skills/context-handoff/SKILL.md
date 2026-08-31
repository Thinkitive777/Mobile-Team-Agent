---
name: context-handoff
description: Write or read a Context Handoff or a Checkpoint — short per-task notes that let a Claude session keep working after /compact or in a new session. Use when a task (feature, bug fix, refactor, migration, investigation, config change, production issue, API integration) is finished, paused, or getting long, or when the user asks to resume earlier work.
---

# Context Handoff & Checkpoint

Two mechanisms, one idea: **never let useful task context die in a compaction.**

| | When | Where | Committed? |
|---|---|---|---|
| **Checkpoint** | Task is **still ongoing** | `.claude/checkpoints/<slug>.md` — updated in place | No |
| **Handoff** | Task is **finished or paused on purpose** | `docs/handoffs/YYYY-MM-DD-<type>-<name>.md` | Yes |

One task = one checkpoint file and, at the end, one handoff file.
Never one big file for the whole project.

---

## PART A — Handoff

### When to offer it

Offer after a meaningful task is finished, or after the user confirms the issue is fixed,
or when the user stops the task on purpose.

Meaningful task: feature, bug fix, refactor, migration, investigation, config change,
architecture change, production issue, API integration.

Show this on its own line:

```
# **CONTEXT HANDOFF AVAILABLE**
```

Then ask:

> The task is complete. Do you want me to write a Context Handoff for this task so we can safely use `/compact` and keep the important context?

**Do not write the file until the user says yes.**
**Do not offer it again once a handoff for this task already exists.**
Do not offer it for small things: one question, a one-line change, a lookup, an explanation.

### After the file is written — mandatory

Print exactly this, on its own line:

```
# **CONTEXT HANDOFF SAVED — YOU CAN NOW USE `/compact`**
```

Then one short line telling the user what to keep during compaction, taken from the
`Compact Focus` section you just wrote. Example:

> Compact while preserving the authentication refactor decisions, changed files, the known 401 issue, and the remaining work.

Then clear the checkpoint: delete `.claude/checkpoints/ACTIVE` (leave the `.md` file).

**Never run `/compact` yourself.** Only the user runs it.

### Where to write it

```
docs/handoffs/YYYY-MM-DD-<type>-<short-name>.md
```

`<type>`: `feature` `bugfix` `refactor` `migration` `investigation` `config` `incident` `integration`

```
docs/handoffs/2026-08-26-feature-payment-history.md
docs/handoffs/2026-08-26-bugfix-login-401.md
```

Get the date from `date +%F`. Do not guess it.

### Handoff template

Fill every section. If a section is empty write `None.` — do not delete it.

```markdown
# <Type>: <Short task name>

## Task
What we were trying to do. 1-3 lines.

## Final Result
What was actually implemented or fixed.

## Important Changes
Files, classes, modules, APIs, config. `path/to/file.kt` — one line each.

## Decisions
Technical decisions made, and the reason in a few words.

## Problems Solved
The real problem and how it was solved.

## Important Discoveries
Things learned about this project that matter later.

## Current State
What works right now.

## Remaining Work
What is not finished. `None.` if nothing.

## Known Risks / Gotchas
What future work must be careful about.

## Validation
What was actually run: build, tests, lint, manual check, with the real result.
Never write a result you did not see.

## Next Step
The single next action if this work continues.

## Compact Focus
**Preserve in detail:** current goal · architecture decisions · changed files ·
unresolved issues · user decisions · constraints · known bugs · remaining work ·
important discoveries.
**Summarize briefly:** completed work · old investigation steps · resolved issues ·
conversation history · tool output.
```

The `Compact Focus` section is not optional. It tells the next compaction what must survive.
Make the two lines specific to this task — do not copy the generic words above.

---

## PART B — Checkpoint

For a task that is **still running**. Cheaper and shorter than a handoff.

Use it when: context is above ~80%, the task is long, the developer is stopping for the
day, or before a risky step.

### Rules

- Slug is `kebab-case`, from the task: `auth-refactor`, `payment-history`.
- If `.claude/checkpoints/ACTIVE` exists, **reuse that slug and update that file in place**.
  Never create a second file for the same task.
- Write the slug into `.claude/checkpoints/ACTIVE`.
- Max 30 lines. Only what would be lost after `/compact`.
- Carry unknowns forward. Mark answered ones `resolved`. Never delete a row.

### Checkpoint template

```markdown
# Checkpoint: <task name>
Updated: <output of `date "+%F %H:%M"`>

## Goal
1-2 lines.

## Current State
What is done, what is half done. Bullets.

## Key Files
`path/to/file` — why it matters. Max 8 lines.

## Decisions
Only decisions that are already settled.

## Unknowns
| ID | Question | Status |
|---|---|---|
| UNKNOWN #001 | What should happen when token refresh fails? | open |

## Next Step
The single next action.

## Compact Focus
**Preserve:** <specific to this task>
**Summarize:** <specific to this task>
```

### After writing

```
CHECKPOINT SAVED — .claude/checkpoints/<slug>.md
```

Plus one line on what to keep during compaction. Do not run `/compact` yourself.

---

## PART C — Reading a handoff or checkpoint (resume)

1. `ls -t docs/handoffs/*.md | head -10` and check `.claude/checkpoints/ACTIVE`.
2. Ask which one, or take the obvious match from the user's words.
3. Read **only that one file**. Do not read all of them.
4. Summarize in 3-5 lines: task, current state, next step, known risks.
5. Check that the files named in `Important Changes` / `Key Files` still exist.
   Say clearly if any are missing.
6. Ask what the user wants to do now. Do not change code before they answer.

A handoff is **Found** information, not **Known** truth — the repo may have moved on
since it was written.

---

## Writing rules for both

- Short lines and bullets. No long paragraphs.
- Simple English. The team level is beginner to intermediate.
- Only what a future session needs. No conversation history, no repeated code.
- Never copy a whole file in. Give the path and the important lines.
- Never write a test or build result you did not actually see.
- Handoff: 40-80 lines. Checkpoint: under 30. Longer means you added noise.
