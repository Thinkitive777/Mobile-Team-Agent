---
description: List and record what is still unclear about the current task, before writing code.
---

Do not write any code in this reply.

$ARGUMENTS

## Step 1 — try to answer it yourself first

For each open question, look in this order and say where you looked:
conversation → repository code → `docs/` → tests → tools.
For anything that needs many files, send a subagent instead of reading them all yourself.

Drop every question you answered. Only real blockers stay.

## Step 2 — report

| ID | Question | Where I looked | Status |
|---|---|---|---|

Status is one of: **Found** (give `file:line`), **Inferred**, **Unknown**, **Needs confirmation**.

For each **Unknown** / **Needs confirmation**, give the options you can see:

```
UNKNOWN #003
> What should happen when token refresh fails?
A. Log the user out
B. Retry once, then log out
C. Show an error and stay on the screen
```

## Step 3 — record

If `.claude/checkpoints/ACTIVE` exists, add the open unknowns to the `## Unknowns`
table of that checkpoint file, in this exact row format:

```
| UNKNOWN #003 | What should happen when token refresh fails? | open |
```

Reuse existing IDs. Mark answered ones `resolved` — never delete the row.

## Step 4

Stop. Wait for the answers. Do not guess and do not start implementing.

If nothing is blocking, say: "Nothing is blocking. Here is my plan:" and give 3-6 lines.
