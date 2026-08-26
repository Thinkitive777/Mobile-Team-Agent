# 3. Commands

Five commands. You will use two of them daily.

| Command | Use when |
|---|---|
| `/unknowns` | Before writing code — what is still unclear? |
| `/context` | "How full is the context? What is open?" |
| `/checkpoint` | Task is **still running**, save the state |
| `/handoff` | Task is **finished or paused**, write the final record |
| `/resume-handoff` | Continue work from an earlier session |

---

## `/unknowns`

Makes Claude list what it cannot safely decide — **before** it writes any code.

Claude first tries to answer each question itself (conversation → code → `docs/` → tests →
tools) and drops everything it could answer. Only real blockers stay.

```
| ID | Question | Where I looked | Status |
|---|---|---|---|
| 1 | Which API returns the refresh token? | src/data/api/AuthApi.kt:31 | Found |
| 2 | What happens when refresh fails? | AuthRepository, AuthViewModel, tests | Unknown |

UNKNOWN #001
> What should happen when token refresh fails?
A. Log the user out
B. Retry once, then log out
C. Show an error and stay on the screen
```

If a checkpoint is open, the unknowns are written into its `## Unknowns` table so they survive
`/compact`. Answered ones are marked `resolved`, never deleted.

---

## `/context`

Short status report. Real numbers only.

```
Task: auth-refactor
Context: 64% of 200k
Unknowns: 2
Checkpoint: Available
Handoff: none
Recommendation: Continue, checkpoint soon
```

If the status line has not run yet, it prints `Context: unknown (status line has not run yet)`.
It will **never** invent a percentage.

---

## `/checkpoint`

The task is **not finished**. Save enough state that `/compact` is safe.

- One file per task: `.claude/checkpoints/<slug>.md`, **updated in place**
- The slug is stored in `.claude/checkpoints/ACTIVE` and shown in the status line
- Under 30 lines
- Open unknowns are carried forward

```
CHECKPOINT SAVED — .claude/checkpoints/auth-refactor.md
Keep: the token-refresh decision, AuthRepository changes, UNKNOWN #001.
```

Use it when: context passes ~80%, the task is long, you are stopping for the day, or before
a risky step.

---

## `/handoff`

The task is **done**, or you are stopping it on purpose.

Claude offers this by itself when a task finishes:

```
# **CONTEXT HANDOFF AVAILABLE**
> The task is complete. Do you want me to write a Context Handoff...?
```

Say yes, or run `/handoff` directly. It writes
`docs/handoffs/YYYY-MM-DD-<type>-<name>.md`, then prints:

```
# **CONTEXT HANDOFF SAVED — YOU CAN NOW USE /compact**
> Compact while preserving the auth refactor decisions, changed files, the 401 issue,
> and the remaining work.
```

It also clears `.claude/checkpoints/ACTIVE`, and will not offer a handoff again for that task.

**Claude never runs `/compact` for you.** You run it.

---

## `/resume-handoff`

Continue earlier work in a new session or after `/clear`.

1. Prefers the open checkpoint over an old handoff
2. Reads **one** file — not all of them
3. Summarizes in 3-5 lines: task, state, next step, risks
4. Checks the files it names still exist, and says so if any are gone
5. Lists open unknowns and asks them
6. Waits — it does not start editing code

---

## The loop

```
Task → Work → /checkpoint or /handoff → /compact → Continue
```

```
/unknowns          answer the blockers first
... work ...
/context           check how full the context is
/checkpoint        still working, context getting big
/compact
... work ...
/handoff           finished
/compact
/clear             next task
```
