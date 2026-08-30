---
description: Save the state of the task you are still working on, so context can be compacted safely.
---

Use the `context-handoff` skill (the "Checkpoint" part).

The task is **still ongoing**. Do not write a handoff. Do not offer one.

$ARGUMENTS

Steps:
1. Pick a task slug (`kebab-case`, from the task, not the date). If
   `.claude/checkpoints/ACTIVE` already exists, reuse that slug — do not start a new file.
2. Write or update `.claude/checkpoints/<slug>.md` using the Checkpoint template.
   Update the existing file in place. Never create a second file for the same task.
3. Write the slug into `.claude/checkpoints/ACTIVE`.
4. Keep it under 30 lines. Only what you would lose after `/compact`.
5. Carry open unknowns forward. Mark answered ones `resolved`.

Then print exactly:

```
CHECKPOINT SAVED — .claude/checkpoints/<slug>.md
```

and one line saying what to keep during compaction. Do not run `/compact` yourself.
