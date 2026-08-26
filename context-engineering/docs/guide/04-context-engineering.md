# 4. Context Engineering

The context window is the real budget. This chapter is how the system protects it.

## The core idea

**One task = one context unit.**

A task is a feature, bug fix, refactor, migration, investigation, config change, architecture
change, production issue, or API integration.

When a task ends, its important facts are written to a small file. Then the conversation can
be compacted or cleared without losing anything that matters.

## Checkpoint vs Handoff

|  | Checkpoint | Handoff |
|---|---|---|
| Task is | still running | finished or paused on purpose |
| File | `.claude/checkpoints/<slug>.md` | `docs/handoffs/YYYY-MM-DD-<type>-<name>.md` |
| Updated | in place, same file every time | written once |
| Size | under 30 lines | 40-80 lines |
| Committed | no | yes |
| Command | `/checkpoint` | `/handoff` |

Checkpoints are cheap and personal. Handoffs are the shared record — a teammate can read one
and continue the work without asking you anything.

## The handoff → compact workflow

This is the part that must not be skipped.

```
1. Task completes
2. Claude prints:   # **CONTEXT HANDOFF AVAILABLE**
                    and asks. It does NOT write the file yet.
3. You say yes  (or run /handoff)
4. Claude writes docs/handoffs/2026-08-26-refactor-auth.md
5. Claude prints:   # **CONTEXT HANDOFF SAVED — YOU CAN NOW USE /compact**
                    plus one line: what to preserve
6. Claude clears .claude/checkpoints/ACTIVE
7. YOU run /compact
```

Rules built into the system:

- Claude **never** writes the handoff without your yes
- Claude **never** runs `/compact` itself
- Claude does **not** offer a handoff again once one exists for that task
- Claude does not offer one for small things — a question, a one-line fix, a lookup

## Compact Focus

Every handoff and checkpoint ends with a `Compact Focus` section. This is what makes the next
compaction smart instead of blind.

```markdown
## Compact Focus
**Preserve in detail:** the decision to refresh tokens in the interceptor ·
AuthRepository.kt and AuthInterceptor.kt changes · UNKNOWN #001 (refresh failure) ·
the 401-loop bug · remaining work on logout
**Summarize briefly:** the three approaches we rejected · the log-reading session ·
the resolved DI wiring problem
```

The general priorities:

| Preserve in detail | Summarize briefly |
|---|---|
| Current task goal | Completed work |
| Architecture decisions | Old investigation steps |
| Important changed files | Already-resolved issues |
| Unresolved issues | Conversation history |
| User decisions | Tool output |
| Constraints and known bugs | |
| Remaining work | |
| Important discoveries | |

The two lines must be **specific to the task**. Copying the generic words above is useless.

## Handoff template

```markdown
# <Type>: <Short task name>

## Task              what we were trying to do (1-3 lines)
## Final Result      what was actually built or fixed
## Important Changes files, classes, modules, APIs, config — one line each
## Decisions         technical decisions + the reason in a few words
## Problems Solved   the real problem and the fix
## Important Discoveries   things learned about this project
## Current State     what works right now
## Remaining Work    what is not finished ("None." if nothing)
## Known Risks / Gotchas
## Validation        what was actually run, with the real result
## Next Step         the single next action
## Compact Focus     preserve / summarize
```

Never write a build or test result you did not see. That rule is absolute.

## Checkpoint template

```markdown
# Checkpoint: <task name>
Updated: <date time>

## Goal
## Current State
## Key Files          max 8 lines
## Decisions          only settled ones
## Unknowns
| ID | Question | Status |
|---|---|---|
| UNKNOWN #001 | What happens when token refresh fails? | open |
## Next Step
## Compact Focus
```

## Context budget

Claude Code gives the status line the real numbers. The system uses them.

| Used | Status line | What happens |
|---|---|---|
| under 60% | `ctx 42%` | nothing |
| 60-79% | `ctx 64%` | status line only |
| 80-89% | `! ctx 82%` | **one** short warning |
| 90%+ | `!! ctx 91%` | **one** stronger warning |

The warning at 80% looks like this, once:

```
# **CONTEXT WARNING — ~82% USED**
> Consider /checkpoint → /compact before continuing.
```

Each band fires **once per session**. There is no warning on every reply. If usage drops after
a compaction, the bands reset and can fire again.

Claude cannot read its own status line. The percentage reaches it through a small state file
written by the status line script. See [Reference](07-reference.md).

## Unknown tracking

When Claude reaches a decision it cannot safely make:

1. It records `UNKNOWN #NNN` in the open checkpoint's `## Unknowns` table
2. It asks you, with the options it can see (A / B / C)
3. It does **not** guess and does not carry on past it
4. When you answer, the row is marked `resolved` — never deleted

`/unknowns` lists them. `/context` counts the open ones.

The `resolved` rows stay because six weeks later "why did we choose B?" is a real question.

## Loading less context

Rules in `CLAUDE.md` §9, in order:

1. You know the file → open it, only the lines you need
2. You know the folder → list it first, then open 1-2 files
3. You know the symbol → `grep` for it
4. Location genuinely unknown → broad search

**Send a subagent for heavy exploration**: large codebase exploration, architecture
investigation, tracing a flow across modules, finding every usage of a component, debugging
across modules, research before implementing.

The subagent reads twenty files. The main session gets four lines back.

Not for small work — a two-file check is faster done directly.

Never dumped into the main session: whole files, whole search results, whole folder trees,
repeated summaries, verbose status updates.

## New task detection

When you clearly switch to an unrelated task, Claude says this once:

```
# **NEW TASK DETECTED**
> This looks unrelated to the previous task. Consider /handoff → /clear before continuing.
```

Only for a real switch — a different feature, module or problem. Not for a follow-up question
or the next step of the same task. This is model judgement, not a script. See
[Troubleshooting](08-troubleshooting.md) for what that means.
